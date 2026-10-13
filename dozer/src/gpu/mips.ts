// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Mip chain generation for the captured page textures (at startup, and after each re-capture of the content texture).
//
// Each level is drawn from the previous one with a full-screen triangle sampling at the 2×2 block centre with a
// linear filter, i.e. a box average. The textures hold premultiplied alpha, so averaging the raw texels is the
// correct filter and keeps them premultiplied (no blend state: the level is overwritten).

const WGSL = /* wgsl */ `
struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); // (0,0) (2,0) (0,2)
  var o: VsOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@fragment fn fs(i: VsOut) -> @location(0) vec4f { return textureSampleLevel(src, samp, i.uv, 0.0); }
`;

/** Number of mip levels down to 1×1 for a square texture of `size`. */
export function mipLevelsFor(size: number): number {
  return Math.floor(Math.log2(Math.max(1, size))) + 1;
}

interface MipGen {
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
}
/** One pipeline per device and format: re-captures regenerate the content mips often. */
const cache = new WeakMap<GPUDevice, Map<GPUTextureFormat, MipGen>>();

function mipGen(device: GPUDevice, format: GPUTextureFormat): MipGen {
  let byFormat = cache.get(device);
  if (!byFormat) cache.set(device, (byFormat = new Map()));
  let gen = byFormat.get(format);
  if (!gen) {
    const module = device.createShaderModule({ label: 'mips', code: WGSL });
    gen = {
      pipeline: device.createRenderPipeline({
        label: 'mips',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      }),
      sampler: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }),
    };
    byFormat.set(format, gen);
  }
  return gen;
}

/** Fills levels 1..n-1 of `texture` (needs RENDER_ATTACHMENT | TEXTURE_BINDING) from level 0. */
export function generateMips(device: GPUDevice, texture: GPUTexture): void {
  if (texture.mipLevelCount < 2) return;
  const { pipeline, sampler } = mipGen(device, texture.format);
  const encoder = device.createCommandEncoder({ label: 'mips' });
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
