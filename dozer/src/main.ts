// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { probeEnvironment } from './capabilities';
import { fatalShown, showFatal } from './fatal';
import { buildPage, setCaptureMode, type CaptureMode } from './page/page';
import { PAGE_SIZE, readConfig } from './config';
import {
  captureOrder,
  captureTextures,
  createCaptureHost,
  createRecapturer,
  isBlank,
  readCaptureFaults,
  runCaptureAttempts,
  type CapturedTextures,
  type CaptureStrategy,
  type RecaptureStats,
} from './capture';
import { extractRects, rectsToBodies } from './extract';
import { packBodies } from './bodies';
import { initGpu } from './gpu/device';
import { COUNTERS_U32, createSimBuffers, resetSimBuffers, type SimBuffers } from './gpu/buffers';
import { createRenderer, loadDozerArt } from './gpu/render';
import { createProf, profFeatures, type Prof } from './gpu/prof';
import { createSim, createStatsReader, STATS_INTERVAL_MS, TUNING, type CounterStats, type Sim } from './gpu/sim';
import { createHud, type Stats } from './hud';
import { clampCamera, viewMatrix, viewWidthFor } from './camera';
import {
  DOZER,
  EXHAUST_ART,
  TRACK_ART,
  artToLocal,
  bladeRegion,
  createKeyboard,
  cuttingEdge,
  dozerPointMotion,
  dozerPolygons,
  stepDozer,
  trackSurfaceSpeed,
  treadOffset,
  type DozerState,
} from './dozer';
import { createStepper, FIXED_DT } from './stepper';
import { createSmoke, SMOKE, SMOKE_INSTANCE_F32 } from './smoke';
import { engineLoadTarget, smoothLoad } from './engine';
import { createDecalStamper } from './decals';
import { createEngineAudio, soundHint } from './audio';
import { POSE_F32, PROPS_F32, SHAPE_F32 } from './bodies';
import {
  initialIntro,
  introActive,
  introDozer,
  introStep,
  planIntro,
  skipIntro,
  type IntroPlan,
  type IntroState,
} from './intro';
import { createKeyHint, DRIVE_KEYS } from './keyhint';
import { createSplash, type Splash } from './splash';
import { createBodyReader } from './gpu/pickread';
import { createPageControls, pageFieldFocused } from './pagecontrols';
import { createInteraction } from './interaction';
import { inConvexPolygon, isTextEntry, pageToWorld } from './interact';

/** Latest HUD stats sample plus initialCount (page bodies) and frame (steps run when it was returned). */
type DebugStats = Partial<Stats> & { initialCount: number; frame: number; sampleFrame?: number };
interface DebugPoses {
  count: number;
  x: number[];
  y: number[];
  angle: number[];
  flags: number[];
  height: number[];
  stress: number[];
}
/** One posePair snapshot: frame = steps run before it; cooldown resets when a body fractures. */
interface DebugPoseSnap {
  frame: number;
  count: number;
  x: number[];
  y: number[];
  flags: number[];
  cooldown: number[];
}
/** Raw per-slot shapes (SHAPE_F32 floats each: 4 local verts then 4 UVs) and flags for slots < count. */
interface DebugShapes {
  count: number;
  shape: Float32Array;
  flags: Uint32Array;
}

declare global {
  interface Window {
    __dozer?: {
      /** Resolves with the first HUD stats sample copied at or after the current frame (no extra readback). */
      stats: () => Promise<DebugStats>;
      /** Simulation steps (FIXED_DT each, up to MAX_SUBSTEPS per rendered frame) run so far. */
      frame: () => number;
      dozer: () => DozerState;
      /** Async readback of the current pose buffer and body flags (debug only; never in the sim loop). */
      poses: () => Promise<DebugPoses>;
      /** Async readback of every live slot's shape (debug only). */
      shapes: () => Promise<DebugShapes>;
      /** Async readback of the blurred occupancy field occF (debug only). */
      occ: () => Promise<{ dim: number; values: number[] }>;
      /**
       * Poses right after two consecutive simulation steps (N and N + 1), copied inside the step loop (debug only):
       * the only way to see single-step displacements, since a rendered frame may run two steps.
       */
      posePair: () => Promise<[DebugPoseSnap, DebugPoseSnap]>;
      /** World-space dozer quads: blade and wing collide, chassis is the outline. */
      footprint: () => { chassis: [number, number][]; blade: [number, number][]; wing: [number, number][] };
      /** Accumulated tread travel (world px, forward positive) of the left and right tracks. */
      treads: () => { left: number; right: number };
      /** World point → CSS px in the view, using the camera of the last rendered frame (for screenshot crops). */
      toScreen: (x: number, y: number) => [number, number];
      /** Smoothed engine load (engine.ts), live smoke particles and the engine sound state (audio.ts). */
      engine: () => { load: number; smoke: number; sound: string; breaks: number; master: number | null };
      /** Boot-time body centres (the packed bodies R restores), for slots < count. */
      bootPoses: () => { count: number; x: number[]; y: number[] };
      /** Scripted intro (intro.ts): its state and plan, and whether the key hint is showing. */
      intro: () => IntroState & { plan: IntroPlan; hint: boolean };
      /**
       * Where the page element matching `selector` (its centre, or page point `at`) is drawn now: the body showing it,
       * its world position and its view CSS px position (pickread snapshot; null when no body shows that point).
       */
      findBody: (
        selector: string,
        at?: [number, number] | null,
        nth?: number,
      ) => Promise<{ index: number; page: [number, number]; world: [number, number]; screen: [number, number] } | null>;
      /** FNV-1a hash of the content texture (mip 0) over page rect (x, y, w, h): changes when a re-capture changed it. */
      contentHash: (x: number, y: number, w: number, h: number) => Promise<number>;
      /** Re-capture count and timings (capture.ts createRecapturer). */
      recaptures: () => RecaptureStats;
      /** Points the camera at world (x, y) instead of following the dozer (null: follow again). */
      lookAt: (at: [number, number] | null) => void;
      /** The focused page text field's tag/type, or null (the keyboard drives the dozer). */
      typing: () => string | null;
    };
    /** `?prof` only (gpu/prof.ts): report() = per-stage GPU ms and CPU ms per frame since reset(). */
    __dozerProf?: Prof;
  }
}

/** Copies `size` bytes of each source buffer into fresh MAP_READ buffers and maps them (debug readback). */
async function readBuffers(device: GPUDevice, sources: { buffer: GPUBuffer; size: number }[]): Promise<ArrayBuffer[]> {
  const encoder = device.createCommandEncoder();
  const staging = sources.map(({ buffer, size }) => {
    const dst = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    encoder.copyBufferToBuffer(buffer, 0, dst, 0, size);
    return dst;
  });
  device.queue.submit([encoder.finish()]);
  return Promise.all(
    staging.map(async (dst) => {
      await dst.mapAsync(GPUMapMode.READ);
      const copy = dst.getMappedRange().slice(0);
      dst.destroy();
      return copy;
    }),
  );
}

/** Debug-only hook called after each sim step, before that step's encoder is submitted. */
let afterStep: ((encoder: GPUCommandEncoder) => void) | null = null;

function debugHooks(
  device: GPUDevice,
  buffers: SimBuffers,
  sim: Sim,
  initialCount: number,
  frame: () => number,
  dozer: () => DozerState,
  stats: () => CounterStats,
  treads: () => { left: number; right: number },
  toScreen: (x: number, y: number) => [number, number],
  engine: () => { load: number; smoke: number; sound: string; breaks: number; master: number | null },
  intro: () => IntroState & { plan: IntroPlan; hint: boolean },
  bootPose: Float32Array,
): NonNullable<Window['__dozer']> {
  const cap = buffers.maxBodies;
  /** Live slot count = min(counters[0], cap), copied in the same submit as the per-body buffers. */
  const readLive = async (
    per: { buffer: GPUBuffer; f32: number }[],
  ): Promise<{ count: number; data: ArrayBuffer[] }> => {
    const [c, ...data] = await readBuffers(device, [
      { buffer: buffers.counters, size: COUNTERS_U32 * 4 },
      ...per.map(({ buffer, f32 }) => ({ buffer, size: cap * f32 * 4 })),
    ]);
    return { count: Math.min(new Uint32Array(c!)[0]!, cap), data: data as ArrayBuffer[] };
  };
  return {
    // Filled in by run() once the interaction pieces exist.
    findBody: async () => null,
    contentHash: async () => 0,
    recaptures: () => ({ count: 0, cpuMs: [], gpuMs: [] }),
    typing: () => null,
    lookAt: () => {},
    frame,
    dozer,
    stats: async () => {
      const want = frame();
      const deadline = performance.now() + 5000; // a failed readback must not hang the caller
      while ((stats().sampleFrame ?? -1) < want && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 30));
      }
      return { ...stats(), initialCount, frame: frame() };
    },
    poses: async () => {
      const {
        count,
        data: [pose, props],
      } = await readLive([
        { buffer: buffers.pose[sim.swapIndex()], f32: POSE_F32 },
        { buffer: buffers.props, f32: PROPS_F32 },
      ]);
      const p = new Float32Array(pose!),
        f = new Uint32Array(props!);
      const out: DebugPoses = { count, x: [], y: [], angle: [], flags: [], height: [], stress: [] };
      const pf = new Float32Array(props!);
      for (let i = 0; i < count; i++) {
        out.x.push(p[i * POSE_F32]!);
        out.y.push(p[i * POSE_F32 + 1]!);
        out.angle.push(p[i * POSE_F32 + 2]!);
        out.flags.push(f[i * PROPS_F32 + 3]!);
        out.stress.push(pf[i * PROPS_F32 + 5]!);
        out.height.push(pf[i * PROPS_F32 + 6]!);
      }
      return out;
    },
    shapes: async () => {
      const {
        count,
        data: [shape, props],
      } = await readLive([
        { buffer: buffers.shape, f32: SHAPE_F32 },
        { buffer: buffers.props, f32: PROPS_F32 },
      ]);
      const pu = new Uint32Array(props!);
      const flags = new Uint32Array(count);
      for (let i = 0; i < count; i++) flags[i] = pu[i * PROPS_F32 + 3]!;
      return { count, shape: new Float32Array(shape!, 0, count * SHAPE_F32), flags };
    },
    posePair: () =>
      new Promise((resolve, reject) => {
        const bytes = [COUNTERS_U32 * 4, cap * POSE_F32 * 4, cap * PROPS_F32 * 4];
        const snaps: { frame: number; dst: GPUBuffer[] }[] = [];
        afterStep = (encoder) => {
          const src = [buffers.counters, buffers.pose[sim.swapIndex()], buffers.props];
          const usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
          const dst = bytes.map((size) => device.createBuffer({ size, usage }));
          dst.forEach((d, k) => encoder.copyBufferToBuffer(src[k]!, 0, d, 0, bytes[k]!));
          snaps.push({ frame: frame(), dst });
          if (snaps.length < 2) return;
          afterStep = null;
          // Mapped in a microtask, after the caller has submitted this step's encoder.
          queueMicrotask(() => {
            Promise.all(
              snaps.map(async ({ frame: f, dst: [c, pose, props] }) => {
                await Promise.all([c!, pose!, props!].map((b) => b.mapAsync(GPUMapMode.READ)));
                const count = Math.min(new Uint32Array(c!.getMappedRange())[0]!, cap);
                const p = new Float32Array(pose!.getMappedRange()),
                  propsRange = props!.getMappedRange();
                const pf = new Float32Array(propsRange),
                  pu = new Uint32Array(propsRange);
                const out: DebugPoseSnap = { frame: f, count, x: [], y: [], flags: [], cooldown: [] };
                for (let i = 0; i < count; i++) {
                  out.x.push(p[i * POSE_F32]!);
                  out.y.push(p[i * POSE_F32 + 1]!);
                  out.flags.push(pu[i * PROPS_F32 + 3]!);
                  out.cooldown.push(pf[i * PROPS_F32 + 7]!);
                }
                [c, pose, props].forEach((b) => b!.destroy());
                return out;
              }),
            ).then((r) => resolve([r[0]!, r[1]!]), reject);
          });
        };
      }),
    footprint: () => {
      const { chassis, blade, wing } = dozerPolygons(dozer());
      return {
        chassis: chassis as [number, number][],
        blade: blade as [number, number][],
        wing: wing as [number, number][],
      };
    },
    treads,
    toScreen,
    engine,
    intro,
    bootPoses: () => {
      const x: number[] = [],
        y: number[] = [];
      for (let i = 0; i < initialCount; i++) {
        x.push(bootPose[i * POSE_F32]!);
        y.push(bootPose[i * POSE_F32 + 1]!);
      }
      return { count: initialCount, x, y };
    },
    occ: async () => {
      const { dim, cells, occF } = buffers.grid;
      const [o] = await readBuffers(device, [{ buffer: occF, size: cells * 4 }]);
      return { dim, values: [...new Float32Array(o!)] };
    },
  };
}

/** Logs every error; shows the fatal panel for the first one only (fatal.ts keeps the first message). */
function fail(err: unknown): void {
  console.error(err);
  showFatal('Something went wrong', [err instanceof Error ? `${err.name}: ${err.message}` : String(err)]);
}

window.addEventListener('unhandledrejection', (ev) => fail(ev.reason));
window.addEventListener('error', (ev) => fail(ev.error ?? ev.message));

/**
 * Debug view: `?showpage[=content|background]` shows the page as plain DOM,
 * scaled to fit the viewport, without the capability probe.
 */
function showPage(modeParam: string): void {
  const mode: CaptureMode = modeParam === 'content' || modeParam === 'background' ? modeParam : 'normal';
  document.getElementById('view')?.remove();
  document.body.style.background =
    mode === 'normal' ? '#111' : 'repeating-conic-gradient(#ccc 0 25%, #eee 0 50%) 0 0 / 32px 32px';
  const root = buildPage(document.body);
  setCaptureMode(root, mode);
  const fit = (): void => {
    const s = Math.min(1, window.innerWidth / PAGE_SIZE, window.innerHeight / PAGE_SIZE);
    root.style.transformOrigin = '0 0';
    root.style.transform = `scale(${s})`;
  };
  fit();
  window.addEventListener('resize', fit);
  console.log(`[dozer] showpage mode=${mode}`);
}

const VIEW_WIDTH = 900;
/** Camera smoothing rate (1/s): c += (d - c) * (1 - exp(-CAMERA_RATE * dt)). */
const CAMERA_RATE = 6;

/** `?capture=2d` puts the 2D drawElementImage fallback first (for testing on browsers that have both). */
function forcedCapture(): CaptureStrategy | null {
  if (new URLSearchParams(location.search).get('capture') !== '2d') return null;
  if (typeof CanvasRenderingContext2D.prototype.drawElementImage !== 'function') {
    throw new Error('?capture=2d requested but CanvasRenderingContext2D.drawElementImage is unavailable');
  }
  return '2d-draw';
}

interface Captured {
  host: HTMLCanvasElement;
  root: HTMLElement;
  tex: CapturedTextures;
}

const BLANK_TITLE = 'The page capture came out empty';
const BLANK_LINES = [
  'HTML-in-Canvas returned a fully transparent image, so there is nothing to bulldoze.',
  'Check that opera://flags/#canvas-draw-element (or chrome://flags/#canvas-draw-element) is Enabled and that the ' +
    'browser was relaunched afterwards.',
  'The window must be visible while the page loads: a minimised window or a background tab is not painted and ' +
    'captures as empty. Bring the window to the front and reload.',
];

/**
 * Captures the page with each available strategy in turn. Every attempt builds a fresh host canvas and page (a canvas
 * cannot switch from a webgpu to a 2d context). An attempt fails when it throws / raises a validation error or when
 * its content texture is fully transparent (one-off startup readback); then the next strategy is tried once.
 * Returns null after showing the fatal panel when every strategy failed.
 */
async function capturePage(
  device: GPUDevice,
  strategies: CaptureStrategy[],
): Promise<(Captured & { strategy: CaptureStrategy }) | null> {
  const faults = readCaptureFaults(location.search);
  const order = captureOrder(strategies, forcedCapture());
  const outcome = await runCaptureAttempts<Captured>(order, async (strategy) => {
    const host = createCaptureHost();
    try {
      const root = buildPage(host);
      const tex = await captureTextures(device, host, root, strategy, faults);
      if (await isBlank(device, tex.content)) {
        console.warn(`[dozer] capture=${strategy} produced an empty image`);
        tex.content.destroy();
        tex.background.destroy();
        host.remove();
        return { ok: false, blank: true };
      }
      return { ok: true, value: { host, root, tex } };
    } catch (err) {
      console.warn(`[dozer] capture=${strategy} failed:`, err);
      host.remove();
      throw err;
    }
  });
  if (!outcome.ok) {
    console.warn(`[dozer] every capture path failed: ${outcome.failures.join('; ')}`);
    if (outcome.blank) showFatal(BLANK_TITLE, [...BLANK_LINES, ...outcome.failures.map((f) => `Tried ${f}.`)]);
    else
      showFatal(
        'Capturing the page failed',
        outcome.failures.map((f) => `Tried ${f}.`),
      );
    return null;
  }
  const fallback = outcome.failures.length ? ` (after: ${outcome.failures.join('; ')})` : '';
  console.log(`[dozer] capture=${outcome.strategy}${fallback}`);
  return { ...outcome.value, strategy: outcome.strategy };
}

/**
 * The intro's lane (intro.ts planIntro): the page element marked data-intro-lane (the hero lede, page/top.ts), its
 * left edge and vertical centre in page px. Falls back to the upper third of the page.
 */
function introLane(root: HTMLElement): { left: number; y: number } {
  const lane = root.querySelector('[data-intro-lane]');
  if (!lane) {
    console.warn('[dozer] no [data-intro-lane] element on the page; the intro uses a default lane');
    return { left: 24, y: PAGE_SIZE / 3 };
  }
  const o = root.getBoundingClientRect(),
    r = lane.getBoundingClientRect();
  return { left: r.left - o.left, y: r.top - o.top + r.height / 2 };
}

async function run(strategies: CaptureStrategy[], splash: Splash): Promise<void> {
  const cfg = readConfig(location.search);
  const view = document.getElementById('view') as HTMLCanvasElement;
  // The capture copies need the device, so the GPU comes up before the page is captured.
  const { device, context, format } = await initGpu(view, cfg.prof ? profFeatures : undefined);
  const prof = cfg.prof ? createProf(device, cfg.prof === 'stages') : null;
  if (prof) window.__dozerProf = prof;

  const captured = await capturePage(device, strategies);
  if (!captured) return;
  const { host, root, tex, strategy } = captured;
  let bodies = rectsToBodies(extractRects(root), PAGE_SIZE);
  const plan = planIntro(introLane(root), PAGE_SIZE);
  // The real page stays alive under the opaque view canvas (z-index -1, never moved, left in content capture mode by
  // captureTextures), so clicks on its bodies can operate it and re-captures match the content texture exactly.

  const maxBodies = cfg.maxAuto !== null ? bodies.length + cfg.maxAuto : cfg.maxBodies;
  if (bodies.length > maxBodies) {
    const drop = bodies.length - maxBodies;
    console.warn(`[dozer] ${bodies.length} bodies exceed capacity ${maxBodies}; dropping the ${drop} smallest`);
    bodies = bodies.slice(0, maxBodies); // sorted by area, largest first
  }
  const packed = packBodies(bodies, maxBodies);
  const sim = createSimBuffers(device, packed, maxBodies);
  const art = await loadDozerArt(device, import.meta.env.BASE_URL);
  const physics = createSim(device, sim, cfg, prof);
  const renderer = createRenderer(device, format, sim, tex, art, () => physics.swapIndex(), prof);

  const statsReader = createStatsReader(device, sim.counters, maxBodies);
  const recapturer = createRecapturer(
    device,
    host,
    root,
    strategy,
    tex.content,
    prof ? (ms) => prof.cpu('recapture', ms) : undefined,
  );
  const bodyReader = createBodyReader(
    device,
    sim,
    () => physics.swapIndex(),
    () => statsReader.latest().bodies ?? packed.count,
  );
  const pageControls = createPageControls(root);
  const hud = createHud(document.getElementById('hud')!);
  const base = import.meta.env.BASE_URL;
  const audio = createEngineAudio(
    `${base}dozer/engine.ogg`,
    `${base}dozer/break.ogg`,
    `${base}dozer/scraping.ogg`,
    window,
    cfg.debug,
  );
  /** sampleFrame of the last stats sample handed to the break sounds. */
  let lastBreakSample = -1;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextEntry(e.target))
      audio.toggleMute();
  });

  const keyboard = createKeyboard(window);
  const hint = createKeyHint(document.getElementById('keyhint')!);
  let intro: IntroState = initialIntro();
  let dozer: DozerState = introDozer(plan);
  let frame = 0;
  /** Accumulated surface travel (world px) of each track's top run relative to the hull; scrolls the treads. */
  const treads = { left: 0, right: 0 };
  const treadY = { left: treadOffset(TRACK_ART.leftTread), right: treadOffset(TRACK_ART.rightTread) };
  /** Engine load (engine.ts), smoothed at the fixed step; drives the smoke. */
  let load = 0;
  const smoke = createSmoke();
  const exhaustLocal = artToLocal(EXHAUST_ART);
  const smokeData = new Float32Array(SMOKE.cap * SMOKE_INSTANCE_F32);
  const stamper = createDecalStamper();
  const addDecal = renderer.addDecal.bind(renderer);
  if (cfg.debug) {
    window.__dozer = debugHooks(
      device,
      sim,
      physics,
      packed.count,
      () => frame,
      () => ({ ...dozer }),
      () => statsReader.latest(),
      () => ({ ...treads }),
      (x, y) => {
        const { camera: c, size, vp } = lastView;
        return [((x - c[0]) / size[0] + 0.5) * vp[0], ((y - c[1]) / size[1] + 0.5) * vp[1]];
      },
      () => ({
        load,
        smoke: smoke.live,
        sound: audio.state(),
        breaks: audio.breaksPlayed(),
        master: audio.masterGain(),
      }),
      () => ({ ...intro, plan, hint: hint.visible() }),
      packed.pose,
    );
  }

  const viewport = (): [number, number] => [view.clientWidth || 1, view.clientHeight || 1];
  const viewSize = (vp: [number, number]): [number, number] => {
    const w = viewWidthFor(vp, VIEW_WIDTH, PAGE_SIZE);
    return [w, (w * vp[1]) / vp[0]];
  };
  let camera = clampCamera([dozer.x, dozer.y], viewSize(viewport()), PAGE_SIZE);
  /** Debug `lookAt`: the camera follows this point instead of the dozer. */
  let cameraTarget: [number, number] | null = null;
  /** Camera of the last rendered frame (debug toScreen, picking). */
  let lastView = { camera, size: viewSize(viewport()), vp: viewport() };
  createInteraction({
    view,
    root,
    controls: pageControls,
    reader: bodyReader,
    viewState: () => lastView,
    onDozer: (x, y) => inConvexPolygon(dozerPolygons(dozer).chassis, x, y),
    recapture: () => recapturer.request(),
    badge: document.getElementById('typing')!,
    onTyping: () => keyboard.clear(),
    heightScale: TUNING,
    pageSize: PAGE_SIZE,
    debug: cfg.debug,
  });
  if (window.__dozer) {
    const toScreen = window.__dozer.toScreen;
    window.__dozer.findBody = async (selector, at, nth = 0) => {
      const el = root.querySelectorAll(selector)[nth];
      if (!el) throw new Error(`findBody: no element matches ${selector}`);
      const o = root.getBoundingClientRect(),
        r = el.getBoundingClientRect();
      const page: [number, number] = at ?? [r.left - o.left + r.width / 2, r.top - o.top + r.height / 2];
      const snap = await bodyReader.read();
      const flags = new Uint32Array(snap.props.buffer, snap.props.byteOffset, snap.props.length);
      for (let i = snap.count - 1; i >= 0; i--) {
        if (!(flags[i * PROPS_F32 + 3]! & 1)) continue;
        const world = pageToWorld(snap, i, page[0], page[1], PAGE_SIZE, TUNING);
        if (world) return { index: i, page, world, screen: toScreen(world[0], world[1]) };
      }
      return null;
    };
    window.__dozer.recaptures = () => recapturer.stats();
    window.__dozer.lookAt = (at) => {
      cameraTarget = at;
      if (at) camera = clampCamera(at, viewSize(viewport()), PAGE_SIZE);
    };
    window.__dozer.contentHash = async (x, y, w, h) => {
      const k = tex.size / PAGE_SIZE;
      const ox = Math.max(0, Math.floor(x * k)),
        oy = Math.max(0, Math.floor(y * k));
      const cw = Math.max(1, Math.min(tex.size - ox, Math.ceil(w * k)));
      const ch = Math.max(1, Math.min(tex.size - oy, Math.ceil(h * k)));
      const bytesPerRow = Math.ceil((cw * 4) / 256) * 256;
      const buffer = device.createBuffer({
        size: bytesPerRow * ch,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex.content, origin: [ox, oy] }, { buffer, bytesPerRow }, [cw, ch]);
      device.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(buffer.getMappedRange());
      let hsh = 0x811c9dc5;
      for (let row = 0; row < ch; row++) {
        for (let i = row * bytesPerRow, e = i + cw * 4; i < e; i++) hsh = Math.imul(hsh ^ px[i]!, 0x01000193) >>> 0;
      }
      buffer.destroy();
      return hsh;
    };
    window.__dozer.typing = () => {
      const f = pageFieldFocused(root) as HTMLInputElement | null;
      return f ? `${f.tagName.toLowerCase()}${f.type ? `:${f.type}` : ''}` : null;
    };
  }
  const stepper = createStepper();

  // R: back to the boot state (bodies from the kept PackedBodies, counters, indirect, dozer, camera) and the intro
  // replays; no re-capture. The dozer restarts off-page, so nothing is under it when it reappears.
  // Any other key (except M, mute) during the intro skips it; a driving key hides the key hint.
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) return;
    if (e.code !== 'KeyR') {
      if (e.code !== 'KeyM' && introActive(intro)) {
        ({ state: intro, dozer } = skipIntro(intro, dozer, plan));
        if (!DRIVE_KEYS.has(e.code)) hint.show();
      }
      if (DRIVE_KEYS.has(e.code)) hint.hide();
      return;
    }
    resetSimBuffers(device, sim, packed);
    physics.reset();
    stepper.reset();
    intro = initialIntro();
    hint.hide();
    dozer = introDozer(plan);
    smoke.reset();
    load = 0;
    stamper.reset();
    renderer.clearDecals();
    camera = clampCamera([dozer.x, dozer.y], viewSize(viewport()), PAGE_SIZE);
  });

  // FPS: EMA of frame times (ignores zero / paused frames).
  let frameTimeEma = 1 / 60;
  let lastHud = -Infinity;
  const updateHud = (rawDt: number): void => {
    if (rawDt > 0 && rawDt < 1) frameTimeEma += (rawDt - frameTimeEma) * 0.1;
    const now = performance.now();
    if (now - lastHud < 250) return;
    lastHud = now;
    const c = statsReader.latest();
    const live = c.bodies ?? packed.count,
      awake = c.active ?? 0;
    hud.update({
      fps: 1 / frameTimeEma,
      bodies: live,
      active: awake,
      asleep: Math.max(0, live - awake), // not counters[3]: the boot sample is taken before any step has counted
      fragments: c.fragments ?? 0,
      gridOverflow: c.gridOverflow ?? 0,
      cap: maxBodies,
    });
  };

  // `?prof`: CPU time per drawFrame section; t() is only called when profiling.
  let tp = 0;
  const t = (label: string): void => {
    const now = performance.now();
    prof!.cpu(label, now - tp);
    tp = now;
  };
  /**
   * One rendered frame: `steps` fixed simulation steps (each its own submit, since every step rewrites the sim
   * uniforms with queue.writeBuffer), then the render pass with the stats copy.
   */
  const drawFrame = (rawDt: number, steps: number): void => {
    if (prof) tp = performance.now();
    const input = keyboard.read();
    for (let k = 0; k < steps; k++) {
      if (introActive(intro)) {
        // The intro drives (keyboard ignored); walls apply once the footprint is inside the page.
        const r = introStep(intro, dozer, FIXED_DT, plan);
        intro = r.state;
        dozer = stepDozer(dozer, r.input, FIXED_DT, PAGE_SIZE, r.walls);
        if (!introActive(intro)) hint.show();
      } else {
        dozer = stepDozer(dozer, input, FIXED_DT, PAGE_SIZE);
      }
      const dLeft = trackSurfaceSpeed(dozer, treadY.left) * FIXED_DT;
      const dRight = trackSurfaceSpeed(dozer, treadY.right) * FIXED_DT;
      treads.left += dLeft;
      treads.right += dRight;
      stamper.step(dozer, dLeft, dRight, addDecal);
      load = smoothLoad(load, engineLoadTarget(dozer), FIXED_DT);
      const exhaust = dozerPointMotion(dozer, exhaustLocal);
      smoke.step(FIXED_DT, exhaust.pos, exhaust.vel, load);
      if (prof) t('dozer+smoke+decals step');
      const encoder = device.createCommandEncoder();
      const { blade, wing } = dozerPolygons(dozer);
      physics.step(encoder, {
        dt: FIXED_DT,
        frame,
        dozer,
        blade,
        wing,
        edge: cuttingEdge(dozer),
        region: bladeRegion(dozer),
      });
      afterStep?.(encoder);
      frame++;
      if (prof) t('sim encode');
      device.queue.submit([encoder.finish()]);
      if (prof) t('sim submit');
    }
    const vp = viewport();
    const size = viewSize(vp);
    const k = 1 - Math.exp(-CAMERA_RATE * steps * FIXED_DT);
    const [tx, ty] = cameraTarget ?? [dozer.x, dozer.y];
    camera = clampCamera([camera[0] + (tx - camera[0]) * k, camera[1] + (ty - camera[1]) * k], size, PAGE_SIZE);
    lastView = { camera, size, vp };
    const encoder = device.createCommandEncoder();
    statsReader.request(encoder, frame);
    audio.setLoad(load, dozer.speed / DOZER.maxSpeed);
    const sample = statsReader.latest();
    if (sample.sampleFrame !== undefined && sample.sampleFrame !== lastBreakSample) {
      lastBreakSample = sample.sampleFrame;
      audio.onFragments(sample.fragments ?? 0, STATS_INTERVAL_MS / 1000);
    }
    hud.setSound(soundHint(audio.state()));
    if (prof) t('camera+stats+audio');
    const smokeCount = smoke.write(smokeData);
    if (prof) t('smoke write');
    renderer.frame(
      encoder,
      context.getCurrentTexture(),
      viewMatrix(camera, vp, size[0]),
      { x: dozer.x, y: dozer.y, angle: dozer.angle, treadLeft: treads.left, treadRight: treads.right },
      { data: smokeData, count: smokeCount },
    );
    prof?.endFrame(encoder);
    if (prof) t('render encode');
    device.queue.submit([encoder.finish()]);
    if (prof) t('render submit');
    updateHud(rawDt);
    if (prof) t('hud');
  };
  drawFrame(0, 0);
  await device.queue.onSubmittedWorkDone();
  console.log(`[dozer] bodies=${packed.count} tex=${tex.size} capture=${strategy} max=${maxBodies}`);
  splash.ready();
  let last = performance.now();
  const loop = (now: number): void => {
    if (fatalShown()) return; // stop on the first fatal error instead of rendering under the panel
    try {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      if (prof) {
        const t0 = performance.now();
        drawFrame(dt, stepper.advance(dt));
        prof.cpu('drawFrame total', performance.now() - t0);
        prof.interval(dt * 1000);
      } else {
        drawFrame(dt, stepper.advance(dt));
      }
    } catch (err) {
      fail(err);
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(loop);
  });
}

async function boot(): Promise<void> {
  try {
    const showpage = new URLSearchParams(location.search).get('showpage');
    if (showpage !== null) {
      showPage(showpage);
      return;
    }
    // The fatal panel (z-index 1000) covers the splash if anything below fails.
    const splash = createSplash(document.getElementById('splash')!);
    const caps = await probeEnvironment();
    if (caps.problems.length) {
      showFatal("Webpage Bulldozer can't start", caps.problems);
      return;
    }
    console.log('[dozer] capabilities ok');
    await run(caps.captureStrategies, splash);
  } catch (err) {
    fail(err);
  }
}

void boot();
