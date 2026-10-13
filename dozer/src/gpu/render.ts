// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import commonWgsl from '../shaders/common.wgsl?raw';
import renderWgsl from '../shaders/render.wgsl?raw';
import type { SimBuffers } from './buffers';
import { BLADE_ART, BODY_ART, DOZER_IMAGE, TRACK_ART, layerQuad, spriteScale, type ArtLayer } from '../dozer';
import { TUNING } from './sim';
import { SMOKE, SMOKE_INSTANCE_F32 } from '../smoke';
import { DECALS, type DecalStamp } from '../decals';
import { PAGE_SIZE } from '../config';
import type { Prof } from './prof';

/** Dozer pose plus each tread's accumulated surface travel (world px, forward positive; main.ts). */
export interface DozerDraw {
  x: number;
  y: number;
  angle: number;
  treadLeft: number;
  treadRight: number;
}

/** The dozer's textures, one per art layer (loadDozerArt). */
export interface DozerArt {
  body: GPUTexture;
  leftTread: GPUTexture;
  rightTread: GPUTexture;
  leftBackground: GPUTexture;
  rightBackground: GPUTexture;
}

/** Smoke instances (smoke.ts write): `count` × SMOKE_INSTANCE_F32 floats. */
export interface SmokeDraw {
  data: Float32Array<ArrayBuffer>;
  count: number;
}

export interface Renderer {
  /** Adds a track print to the decal ring (overwrites the oldest when full; one small writeBuffer). */
  addDecal(d: DecalStamp): void;
  /** Hides every print made so far (R reset). */
  clearDecals(): void;
  frame(
    encoder: GPUCommandEncoder,
    target: GPUTexture,
    viewMat: Float32Array,
    dozer: DozerDraw | null,
    smoke?: SmokeDraw | null,
  ): void;
}

/** viewMat (mat3x3f, 48 B) + time + heightScale + heightRest + bodyShadowAlpha. */
const UNIFORM_BYTES = 64;
/** render.wgsl Layer: pos, angle, alpha | quad | offset, uShift, shadow | cut | cutSide, pad, blur. */
const LAYER_UNIFORM_BYTES = 80;
/** Dozer art layers drawn per frame (blade shadow, blade, 5 above-text shadows, 5 above-text layers). */
const LAYER_COUNT = 12;
/** Stride of one layer's uniforms in the shared layer buffer (minUniformBufferOffsetAlignment). */
const LAYER_STRIDE = 256;
const SHADOW_ALPHA = 0.35;
const SHADOW_OFFSET: [number, number] = [8, 10];
/** Dozer drop-shadow blur: tap offset in image px (render.wgsl fs_layer). */
const SHADOW_BLUR_PX = 3;
/** Pile drop-shadow alpha (× texture alpha) for raised bodies. */
const BODY_SHADOW_ALPHA = 0.28;
const CLEAR: GPUColor = { r: 0x20 / 255, g: 0x21 / 255, b: 0x24 / 255, a: 1 };
/**
 * Stencil for drop shadows. WebGPU compares `reference <op> stored`. Each shadow group draws only where its reference
 * is greater than the stored value and writes the reference, so a group adds at most one shadow layer per pixel
 * (stacked glyph shadows otherwise compound to a near-opaque grey haze): 1 = shadows of the bodies under the blade,
 * 2 = the blade's shadow, 3 = shadows of the scooped bodies riding on the blade, 4 = the shadows of the dozer's
 * above-text parts. Every other pipeline uses the default always/keep stencil state.
 */
const STENCIL_FORMAT: GPUTextureFormat = 'stencil8';
const STENCIL_NONE: GPUDepthStencilState = { format: STENCIL_FORMAT };
const STENCIL_ONCE_FACE: GPUStencilFaceState = { compare: 'greater', passOp: 'replace' };
const STENCIL_ONCE: GPUDepthStencilState = {
  format: STENCIL_FORMAT,
  stencilFront: STENCIL_ONCE_FACE,
  stencilBack: STENCIL_ONCE_FACE,
};
const STENCIL_REF = { pileShadow: 1, bladeShadow: 2, scoopedShadow: 3, dozerShadow: 4 } as const;
const PREMULTIPLIED: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

export function createRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  sim: SimBuffers,
  tex: { content: GPUTexture; background: GPUTexture },
  art: DozerArt,
  /** Which pose buffer holds the latest simulated pose (sim.swapIndex). */
  poseIndex: () => 0 | 1,
  /** `?prof` only: timestamps around the render pass. */
  prof: Prof | null = null,
): Renderer {
  const module = device.createShaderModule({
    label: 'render',
    code: `const PAGE_SIZE: f32 = ${PAGE_SIZE}.0;\n${commonWgsl}\n${renderWgsl}`,
  });
  const V = GPUShaderStage.VERTEX,
    F = GPUShaderStage.FRAGMENT;
  const bgl = device.createBindGroupLayout({
    label: 'render',
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: F, sampler: { type: 'filtering' } },
      { binding: 5, visibility: F, texture: { sampleType: 'float' } },
      { binding: 6, visibility: F, texture: { sampleType: 'float' } },
      { binding: 7, visibility: V, buffer: { type: 'uniform' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipeline = (entry: 'background' | 'body' | 'shadow'): GPURenderPipeline =>
    device.createRenderPipeline({
      label: entry,
      layout,
      vertex: { module, entryPoint: `vs_${entry}` },
      fragment: { module, entryPoint: `fs_${entry}`, targets: [{ format, blend: PREMULTIPLIED }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil: entry === 'shadow' ? STENCIL_ONCE : STENCIL_NONE,
    });
  const backgroundPipeline = pipeline('background');
  const bodyPipeline = pipeline('body');
  const shadowPipeline = pipeline('shadow');

  // Dozer layers: one pipeline for the art, one (stencilled) for drop shadows; one bind group per draw.
  const layerBgl = device.createBindGroupLayout({
    label: 'dozer layer',
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: { sampleType: 'float' } },
      { binding: 2, visibility: F, sampler: { type: 'filtering' } },
    ],
  });
  const layerPipeline = (label: string, depthStencil: GPUDepthStencilState): GPURenderPipeline =>
    device.createRenderPipeline({
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl, layerBgl] }),
      vertex: { module, entryPoint: 'vs_layer' },
      fragment: { module, entryPoint: 'fs_layer', targets: [{ format, blend: PREMULTIPLIED }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil,
    });
  const artPipeline = layerPipeline('dozer art', STENCIL_NONE);
  const artShadowPipeline = layerPipeline('dozer shadow', STENCIL_ONCE);
  const clampSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  // Treads tile along u and scroll (uShift); v stays clamped.
  const repeatSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });
  // Cut line between the blade layer (under the text) and the body layer (over it), in dozer.png uv.
  const [cutA, cutB] = BLADE_ART.cut as [[number, number], [number, number]];
  const cut = [cutA[0] / DOZER_IMAGE[0], cutA[1] / DOZER_IMAGE[1], cutB[0] / DOZER_IMAGE[0], cutB[1] / DOZER_IMAGE[1]];
  type Side = 'blade' | 'body' | 'all';
  interface LayerDraw {
    data: Float32Array<ArrayBuffer>;
    group: GPUBindGroup;
    tread: 'left' | 'right' | null;
    period: number;
  }
  // Every layer's uniforms live in one buffer (LAYER_STRIDE apart), refreshed with a single writeBuffer per frame.
  const layerData = new Float32Array((LAYER_COUNT * LAYER_STRIDE) / 4);
  const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const layerBuffer = device.createBuffer({ label: 'dozer layers', size: layerData.byteLength, usage: UNIFORM });
  let layerCount = 0;
  const makeLayer = (
    l: ArtLayer,
    texture: GPUTexture,
    opts: { side?: Side; shadow?: boolean; tread?: 'left' | 'right' },
  ): LayerDraw => {
    if (layerCount >= LAYER_COUNT) throw new Error('render: more dozer layers than LAYER_COUNT');
    const offset = layerCount++ * LAYER_STRIDE;
    const q = layerQuad(l);
    const shadow = opts.shadow ?? false;
    const side = opts.side ?? 'all';
    const data = layerData.subarray(offset / 4, (offset + LAYER_UNIFORM_BYTES) / 4);
    data.set([
      0,
      0,
      0,
      shadow ? SHADOW_ALPHA : 1,
      q.minX,
      q.maxX,
      q.minY,
      q.maxY,
      shadow ? SHADOW_OFFSET[0] : 0,
      shadow ? SHADOW_OFFSET[1] : 0,
      0,
      shadow ? 1 : 0,
      ...cut,
      side === 'body' ? 1 : side === 'blade' ? -1 : 0,
      0,
      SHADOW_BLUR_PX / l.size[0],
      SHADOW_BLUR_PX / l.size[1],
    ]);
    const group = device.createBindGroup({
      label: `dozer layer ${l.file}`,
      layout: layerBgl,
      entries: [
        { binding: 0, resource: { buffer: layerBuffer, offset, size: LAYER_UNIFORM_BYTES } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: opts.tread ? repeatSampler : clampSampler },
      ],
    });
    // One texture width of tread = l.size[0] image px = spriteScale · l.size[0] world px of travel.
    return { data, group, tread: opts.tread ?? null, period: spriteScale * l.size[0] };
  };
  const T = TRACK_ART;
  /** Above-text art, bottom to top: treads, track backgrounds, the body side of dozer.png. */
  const overSpecs: [ArtLayer, GPUTexture, { side?: Side; tread?: 'left' | 'right' }][] = [
    [T.leftTread, art.leftTread, { tread: 'left' }],
    [T.rightTread, art.rightTread, { tread: 'right' }],
    [T.leftBackground, art.leftBackground, {}],
    [T.rightBackground, art.rightBackground, {}],
    [BODY_ART, art.body, { side: 'body' }],
  ];
  const bladeShadow = makeLayer(BODY_ART, art.body, { side: 'blade', shadow: true });
  const blade = makeLayer(BODY_ART, art.body, { side: 'blade' });
  const overShadows = overSpecs.map(([l, t, o]) => makeLayer(l, t, { ...o, shadow: true }));
  const over = overSpecs.map(([l, t, o]) => makeLayer(l, t, o));
  const allLayers = [bladeShadow, blade, ...overShadows, ...over];

  // Track decals: FIFO ring of DECALS.cap prints in a storage buffer (8 floats each), faded by age in stamps.
  const DECAL_F32 = 8;
  const decalBgl = device.createBindGroupLayout({
    label: 'decals',
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, texture: { sampleType: 'float' } },
      { binding: 3, visibility: F, texture: { sampleType: 'float' } },
      { binding: 4, visibility: F, sampler: { type: 'filtering' } },
    ],
  });
  const decalPipeline = device.createRenderPipeline({
    label: 'decals',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl, decalBgl] }),
    vertex: { module, entryPoint: 'vs_decal' },
    fragment: { module, entryPoint: 'fs_decal', targets: [{ format, blend: PREMULTIPLIED }] },
    primitive: { topology: 'triangle-strip' },
    depthStencil: STENCIL_NONE,
  });
  const decalBuffer = device.createBuffer({
    label: 'decals',
    size: DECALS.cap * DECAL_F32 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const decalUniforms = device.createBuffer({ label: 'decal uniforms', size: 32, usage: UNIFORM });
  const decalGroup = device.createBindGroup({
    layout: decalBgl,
    entries: [
      { binding: 0, resource: { buffer: decalUniforms } },
      { binding: 1, resource: { buffer: decalBuffer } },
      { binding: 2, resource: art.leftTread.createView() },
      { binding: 3, resource: art.rightTread.createView() },
      { binding: 4, resource: repeatSampler },
    ],
  });
  /** Print = DECALS.spacing long (one lug: uSpan of the tread texture) × the tread's width. */
  const treadQuad = layerQuad(TRACK_ART.leftTread);
  const decalU = new Float32Array([
    0,
    0,
    DECALS.cap,
    DECALS.alphaNew,
    DECALS.spacing / 2,
    (treadQuad.maxY - treadQuad.minY) / 2,
    DECALS.spacing / (spriteScale * TRACK_ART.leftTread.size[0]),
    0,
  ]);
  const decalEntry = new Float32Array(DECAL_F32);
  /** Stamps made so far (the next print's seq) and the first seq still shown. */
  let decalSeq = 0,
    decalMinSeq = 0;

  // Smoke: instanced soft sprites from a vertex buffer rewritten each frame (≤ SMOKE.cap × 32 B).
  const smokePipeline = device.createRenderPipeline({
    label: 'smoke',
    layout,
    vertex: {
      module,
      entryPoint: 'vs_smoke',
      buffers: [
        {
          arrayStride: SMOKE_INSTANCE_F32 * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs_smoke', targets: [{ format, blend: PREMULTIPLIED }] },
    primitive: { topology: 'triangle-strip' },
    depthStencil: STENCIL_NONE,
  });
  const smokeBuffer = device.createBuffer({
    label: 'smoke',
    size: SMOKE.cap * SMOKE_INSTANCE_F32 * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const drawLayers = (pass: GPURenderPassEncoder, p: GPURenderPipeline, layers: LayerDraw[]): void => {
    pass.setPipeline(p);
    for (const l of layers) {
      pass.setBindGroup(1, l.group);
      pass.draw(4);
    }
  };
  const updateLayers = (d: DozerDraw): void => {
    for (const l of allLayers) {
      l.data[0] = d.x;
      l.data[1] = d.y;
      l.data[2] = d.angle;
      // Sampling u − travel/period moves the tread pattern forward (+u = +x) as the top run advances.
      if (l.tread) l.data[10] = ((l.tread === 'left' ? d.treadLeft : d.treadRight) / l.period) % 1;
    }
    device.queue.writeBuffer(layerBuffer, 0, layerData);
  };

  const uniforms = device.createBuffer({ label: 'render uniforms', size: UNIFORM_BYTES, usage: UNIFORM });
  // Trilinear: the page textures carry a full mip chain (capture.ts / mips.ts), so zoomed-out text doesn't shimmer.
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
  const contentView = tex.content.createView();
  const backgroundView = tex.background.createView();
  /** Body layer selectors (render.wgsl BodyLayer): 1 = not scooped (under the blade), 2 = scooped (over it). */
  const layerBuffers = [1, 2].map((v) => {
    const b = device.createBuffer({ label: `body layer ${v}`, size: 16, usage: UNIFORM });
    device.queue.writeBuffer(b, 0, new Uint32Array([v, 0, 0, 0]));
    return b;
  });
  const bindGroupFor = (p: 0 | 1, layer: 0 | 1): GPUBindGroup =>
    device.createBindGroup({
      label: `render pose${p} layer${layer + 1}`,
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer: sim.pose[p] } },
        { binding: 2, resource: { buffer: sim.shape } },
        { binding: 3, resource: { buffer: sim.props } },
        { binding: 4, resource: sampler },
        { binding: 5, resource: contentView },
        { binding: 6, resource: backgroundView },
        { binding: 7, resource: { buffer: layerBuffers[layer]! } },
      ],
    });
  /** bindGroups[pose][layer]: layer 0 = bodies under the blade, 1 = scooped bodies over it. */
  const bindGroups = [
    [bindGroupFor(0, 0), bindGroupFor(0, 1)],
    [bindGroupFor(1, 0), bindGroupFor(1, 1)],
  ] as const;
  const uniformData = new Float32Array(UNIFORM_BYTES / 4);
  const t0 = performance.now();
  let stencil: GPUTexture | null = null;
  const stencilFor = (target: GPUTexture): GPUTextureView => {
    if (!stencil || stencil.width !== target.width || stencil.height !== target.height) {
      stencil?.destroy();
      stencil = device.createTexture({
        label: 'shadow stencil',
        size: [target.width, target.height],
        format: STENCIL_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return stencil.createView();
  };

  return {
    addDecal(d) {
      decalEntry.set([d.x, d.y, d.angle, decalSeq, d.side, 0, 0, 0]);
      device.queue.writeBuffer(decalBuffer, (decalSeq % DECALS.cap) * DECAL_F32 * 4, decalEntry);
      decalSeq++;
    },
    clearDecals() {
      decalMinSeq = decalSeq;
    },
    frame(encoder, target, viewMat, dozer, smoke) {
      uniformData.set(viewMat.subarray(0, 12), 0);
      uniformData[12] = (performance.now() - t0) / 1000;
      uniformData[13] = TUNING.heightScale;
      uniformData[14] = TUNING.heightRest;
      uniformData[15] = BODY_SHADOW_ALPHA;
      device.queue.writeBuffer(uniforms, 0, uniformData);
      const desc: GPURenderPassDescriptor = {
        label: 'render',
        colorAttachments: [{ view: target.createView(), clearValue: CLEAR, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: {
          view: stencilFor(target),
          stencilClearValue: 0,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'discard',
        },
      };
      if (prof) desc.timestampWrites = prof.ts('render');
      const pass = encoder.beginRenderPass(desc);
      const groups = bindGroups[poseIndex()];
      pass.setBindGroup(0, groups[0]);
      pass.setPipeline(backgroundPipeline);
      pass.draw(4);
      // Track prints mark the page under everything else.
      const prints = Math.min(decalSeq - decalMinSeq, DECALS.cap);
      if (prints > 0) {
        // seqNow = the newest print's seq, so the newest print has age 0.
        decalU[0] = decalSeq - 1;
        decalU[1] = decalMinSeq;
        device.queue.writeBuffer(decalUniforms, 0, decalU);
        pass.setPipeline(decalPipeline);
        pass.setBindGroup(1, decalGroup);
        pass.draw(4, Math.min(decalSeq, DECALS.cap));
      }
      // Bodies under the blade (not scooped: their shadows, then the bodies), the blade (its shadow, then the art), the
      // scooped bodies riding on it (shadows, bodies), and over everything the rest of the dozer: the drop shadows of
      // its above-text parts, the treads, the track backgrounds and the body.
      const bodies = (group: GPUBindGroup, shadowRef: number): void => {
        pass.setBindGroup(0, group);
        pass.setStencilReference(shadowRef);
        pass.setPipeline(shadowPipeline);
        pass.drawIndirect(sim.indirect, 0);
        pass.setPipeline(bodyPipeline);
        pass.drawIndirect(sim.indirect, 0);
      };
      bodies(groups[0], STENCIL_REF.pileShadow);
      if (dozer) {
        updateLayers(dozer);
        pass.setStencilReference(STENCIL_REF.bladeShadow);
        drawLayers(pass, artShadowPipeline, [bladeShadow]);
        drawLayers(pass, artPipeline, [blade]);
      }
      bodies(groups[1], STENCIL_REF.scoopedShadow);
      if (dozer) {
        pass.setStencilReference(STENCIL_REF.dozerShadow);
        drawLayers(pass, artShadowPipeline, overShadows);
        drawLayers(pass, artPipeline, over);
      }
      if (smoke && smoke.count > 0) {
        const n = Math.min(smoke.count, SMOKE.cap);
        device.queue.writeBuffer(smokeBuffer, 0, smoke.data, 0, n * SMOKE_INSTANCE_F32);
        pass.setPipeline(smokePipeline);
        pass.setVertexBuffer(0, smokeBuffer);
        pass.draw(4, n);
      }
      pass.end();
    },
  };
}

/** Loads every dozer art layer from `${base}dozer/` (public/dozer/). */
export async function loadDozerArt(device: GPUDevice, base: string): Promise<DozerArt> {
  const T = TRACK_ART;
  const load = (l: ArtLayer): Promise<GPUTexture> => loadSprite(device, `${base}dozer/${l.file}`);
  const [body, leftTread, rightTread, leftBackground, rightBackground] = await Promise.all(
    [BODY_ART, T.leftTread, T.rightTread, T.leftBackground, T.rightBackground].map(load),
  );
  return {
    body: body!,
    leftTread: leftTread!,
    rightTread: rightTread!,
    leftBackground: leftBackground!,
    rightBackground: rightBackground!,
  };
}

/** Loads an image into an rgba8unorm texture with premultiplied alpha (matching the blend state). */
export async function loadSprite(device: GPUDevice, url: string): Promise<GPUTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load sprite ${url}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = device.createTexture({
    label: url,
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture, premultipliedAlpha: true }, [
    bitmap.width,
    bitmap.height,
  ]);
  bitmap.close();
  return texture;
}
