// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/*
 * Two-pass capture of the page into GPU textures.
 *
 * API notes (Chromium):
 * - Both queue methods take two dictionaries; positional element arguments throw:
 *     queue.copyElementImageToTexture({ source, sx?, sy?, swidth?, sheight? },
 *       { destination: { texture, origin?, mipLevel?, premultipliedAlpha?, ... }, width?, height? })
 *   The host canvas must hold a WebGPU context configured with the same device. Call inside a `paint` listener.
 * - Without width/height the copy is CSS size × devicePixelRatio. With an explicit width/height the element is
 *   re-rasterised at that size (not upscaled), so passing the texture size gives crisp results at any DPR.
 * - No clipping: a child larger than its canvas is captured completely.
 * - A canvas that is off-screen or has `opacity: 0` is not painted and captures as transparent; one left in place
 *   under the opaque view canvas (`z-index: -1`) captures normally.
 * - 2D path: `ctx.drawElementImage(el, 0, 0)` rasterises at the canvas backing-store scale.
 *
 * A canvas cannot switch context types, so every capture attempt builds a fresh host canvas and page.
 */
import { BG_TEX_SIZE, PAGE_SIZE, TEX_SIZE } from './config';
import { setCaptureMode } from './page/page';
import { generateMips, mipLevelsFor } from './gpu/mips';
import type { CaptureStrategy } from './capabilities';
import { fatalShown } from './fatal';

export type { CaptureStrategy };

/** size = content texture size (TEX_SIZE, or less on devices with a smaller maxTextureDimension2D); bgSize likewise. */
export interface CapturedTextures {
  content: GPUTexture;
  background: GPUTexture;
  size: number;
  bgSize: number;
}

/** Debug fault injection (`?debug&capfail=…&capblank=…`) to exercise the fallback and blank detection. */
export interface CaptureFaults {
  /** Strategies whose capture call throws. */
  fail: ReadonlySet<CaptureStrategy>;
  /** Strategies whose capture call is skipped, leaving the textures transparent. */
  blank: ReadonlySet<CaptureStrategy>;
}

export const NO_FAULTS: CaptureFaults = { fail: new Set(), blank: new Set() };

const STRATEGIES: CaptureStrategy[] = ['gpu-copy', '2d-draw'];

/** Parses `capfail` / `capblank` (values gpu-copy, 2d-draw or all); only honoured together with `debug`. */
export function readCaptureFaults(search: string): CaptureFaults {
  const params = new URLSearchParams(search);
  if (!params.has('debug')) return NO_FAULTS;
  const parse = (v: string | null): Set<CaptureStrategy> =>
    new Set(v === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s === v));
  return { fail: parse(params.get('capfail')), blank: parse(params.get('capblank')) };
}

/** Attempt order: `available` (preferred first) with `forced` moved to the front when it is available. */
export function captureOrder(available: readonly CaptureStrategy[], forced: CaptureStrategy | null): CaptureStrategy[] {
  if (!forced || !available.includes(forced)) return [...available];
  return [forced, ...available.filter((s) => s !== forced)];
}

export type AttemptResult<T> = { ok: true; value: T } | { ok: false; blank: true };
export type CaptureOutcome<T> =
  | { ok: true; strategy: CaptureStrategy; value: T; failures: string[] }
  | { ok: false; blank: boolean; failures: string[] };

/**
 * Tries each strategy in order until one yields a non-blank capture. `attempt` throws on failure or returns
 * { ok: false, blank: true } for an empty image. `blank` in the outcome = at least one path produced an empty image.
 */
export async function runCaptureAttempts<T>(
  order: readonly CaptureStrategy[],
  attempt: (s: CaptureStrategy) => Promise<AttemptResult<T>>,
): Promise<CaptureOutcome<T>> {
  const failures: string[] = [];
  let blank = false;
  for (const strategy of order) {
    try {
      const r = await attempt(strategy);
      if (r.ok) return { ok: true, strategy, value: r.value, failures };
      blank = true;
      failures.push(`${strategy}: the captured image was empty`);
    } catch (err) {
      failures.push(`${strategy}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: false, blank, failures };
}

const PAINT_FALLBACK_MS = 1000;
const PAINT_TIMEOUT_MS = 8000;

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Requests a paint (when requestPaint exists) and runs `onPaint` synchronously inside the first `paint` event that
 * lists `root` in changedElements, or inside any paint after PAINT_FALLBACK_MS.
 */
function onNextPaint(canvas: HTMLCanvasElement, root: HTMLElement, onPaint: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let anyPaint = false;
    const fallback = setTimeout(() => {
      anyPaint = true;
      canvas.requestPaint?.();
    }, PAINT_FALLBACK_MS);
    const timeout = setTimeout(() => {
      done();
      reject(new Error(`no paint event within ${PAINT_TIMEOUT_MS} ms`));
    }, PAINT_TIMEOUT_MS);
    const handler = (ev: Event): void => {
      const changed = (ev as PaintEvent).changedElements ?? [];
      if (!anyPaint && !changed.includes(root)) return;
      done();
      try {
        onPaint();
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    const done = (): void => {
      clearTimeout(fallback);
      clearTimeout(timeout);
      canvas.removeEventListener('paint', handler);
    };
    canvas.addEventListener('paint', handler);
    canvas.requestPaint?.();
  });
}

/** A page-sized layoutsubtree canvas under the (opaque) view canvas; it must stay painted to capture. */
export function createCaptureHost(): HTMLCanvasElement {
  const host = document.createElement('canvas');
  host.id = 'capture';
  host.setAttribute('layoutsubtree', 'true');
  host.setAttribute('content', 'drawable');
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: '-1',
    width: `${PAGE_SIZE}px`,
    height: `${PAGE_SIZE}px`,
  });
  document.body.prepend(host);
  return host;
}

/**
 * The copy of `root` into a texture of either strategy (call it inside a `paint` event): 'gpu-copy' configures the
 * canvas's WebGPU context (once; a second configure is harmless) and re-rasterises the page at the texture size;
 * '2d-draw' draws into the canvas's 2D backing store (sized to the texture by the caller) and uploads it.
 */
export function createCopier(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  mode: CaptureStrategy,
): (texture: GPUTexture) => void {
  if (mode === 'gpu-copy') {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('capture canvas has no webgpu context');
    ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' });
    const queue = device.queue;
    if (typeof queue.copyElementImageToTexture !== 'function') {
      throw new Error('GPUQueue.copyElementImageToTexture is unavailable');
    }
    return (texture) =>
      queue.copyElementImageToTexture!(
        { source: root },
        { destination: { texture, premultipliedAlpha: true }, width: texture.width, height: texture.height },
      );
  }
  const ctx = canvas.getContext('2d');
  if (!ctx?.drawElementImage) throw new Error('2D drawElementImage is unavailable');
  return (texture) => {
    const dim = texture.width;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawElementImage!(root, 0, 0);
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: true }, [dim, dim]);
  };
}

/**
 * Captures `root` (a drawable child of `canvas`) twice: background-only, then content-only. On success the page is
 * LEFT in content mode (and on the 2D path the backing store stays at the content size), so the page can be
 * re-captured into the same content texture later (createRecapturer); on failure it goes back to normal mode.
 * Textures are rgba8unorm, premultiplied, with a full mip chain generated from level 0.
 */
export async function captureTextures(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  mode: CaptureStrategy,
  faults: CaptureFaults = NO_FAULTS,
): Promise<CapturedTextures> {
  const maxDim = device.limits.maxTextureDimension2D;
  const size = Math.min(TEX_SIZE, maxDim);
  const bgSize = Math.min(BG_TEX_SIZE, maxDim);
  const makeTexture = (label: string, dim: number): GPUTexture =>
    device.createTexture({
      label,
      size: [dim, dim],
      format: 'rgba8unorm',
      mipLevelCount: mipLevelsFor(dim),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

  let copy = createCopier(device, canvas, root, mode);
  if (faults.fail.has(mode)) {
    copy = () => {
      throw new Error(`simulated ${mode} failure (?capfail)`);
    };
  } else if (faults.blank.has(mode)) {
    copy = () => {}; // textures stay zero-initialised: fully transparent
  }

  await imagesReady(root);
  const content = makeTexture('content', size);
  const background = makeTexture('background', bgSize);
  try {
    for (const [pass, texture] of [
      ['background', background],
      ['content', content],
    ] as const) {
      setCaptureMode(root, pass);
      // The 2D path rasterises at the backing-store scale: size it for this pass before the paint.
      if (mode === '2d-draw' && canvas.width !== texture.width) canvas.width = canvas.height = texture.width;
      await nextFrame();
      device.pushErrorScope('validation');
      let thrown: unknown = null;
      try {
        await onNextPaint(canvas, root, () => copy(texture));
      } catch (err) {
        thrown = err;
      }
      const err = await device.popErrorScope();
      if (thrown) throw new Error(`${pass} pass: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      if (err) throw new Error(`${pass} pass: ${err.message}`);
    }
  } catch (err) {
    content.destroy();
    background.destroy();
    setCaptureMode(root, 'normal');
    // A 2D backing store of the content size is ~150 MB; drop it when this attempt failed.
    if (mode === '2d-draw') canvas.width = canvas.height = 1;
    throw err;
  }
  generateMips(device, content);
  generateMips(device, background);
  return { content, background, size, bgSize };
}

/** Waits until every <img> in `root` has loaded and decoded (a broken image just stops counting), so it is painted. */
async function imagesReady(root: HTMLElement): Promise<void> {
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
}

/** Coarse level (≤ 64 px) used by isBlank: a box average of the whole image, so any visible pixel survives. */
const BLANK_PROBE_DIM = 64;

/**
 * Startup-only readback: true when the coarse mip level of `texture` (≤ 64×64, ≤ 16 KB) is fully transparent.
 * Requires the mip chain (captureTextures generates it) and COPY_SRC.
 */
export async function isBlank(device: GPUDevice, texture: GPUTexture): Promise<boolean> {
  let level = 0;
  while (level < texture.mipLevelCount - 1 && texture.width >> level > BLANK_PROBE_DIM) level++;
  const dim = Math.max(1, texture.width >> level);
  const rows = Math.max(1, texture.height >> level);
  const bytesPerRow = Math.ceil((dim * 4) / 256) * 256;
  const buffer = device.createBuffer({
    label: 'blank probe',
    size: bytesPerRow * rows,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'blank probe' });
  encoder.copyTextureToBuffer({ texture, mipLevel: level }, { buffer, bytesPerRow }, [dim, rows]);
  device.queue.submit([encoder.finish()]);
  try {
    await buffer.mapAsync(GPUMapMode.READ);
    const px = new Uint8Array(buffer.getMappedRange());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < dim; x++) if (px[y * bytesPerRow + x * 4 + 3]! > 0) return false;
    }
    return true;
  } finally {
    if (buffer.mapState === 'mapped') buffer.unmap();
    buffer.destroy();
  }
}

/** Re-capture timings (ms) for `__dozer.recaptures()`. */
export interface RecaptureStats {
  count: number;
  /** CPU time of the copy call plus the mip encode and submit. */
  cpuMs: number[];
  /**
   * Approximate GPU time of the copy and the mips: from when the work queued before the copy finished (or the copy
   * call, if later) until the copy and the mips finished (onSubmittedWorkDone; coarse, includes callback latency).
   */
  gpuMs: number[];
}

export interface Recapturer {
  /** Asks for a re-capture at the next paint (after an interaction); paints that list the page re-capture anyway. */
  request(): void;
  stats(): RecaptureStats;
}

/** Keep at most this many timing samples. */
const RECAPTURE_SAMPLES = 200;

/**
 * Keeps the content texture in step with the live page: every `paint` event of the capture canvas that lists `root` in
 * changedElements (the page subtree changed: a checkbox flipped, a caret blinked, text was typed), or any paint after
 * request(), copies the whole page into the SAME content texture (it must still be in content mode, as
 * captureTextures leaves it) and regenerates its mips. At most one copy per animation frame; a paint in a frame that
 * already copied asks for another paint instead. The background texture is never touched.
 *
 * The copy call blocks the main thread for ~10–25 ms (Apple M-series) whatever the source rect, so every re-capture
 * copies the whole page.
 */
export function createRecapturer(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  mode: CaptureStrategy,
  content: GPUTexture,
  onCost?: (cpuMs: number) => void,
): Recapturer {
  const copy = createCopier(device, canvas, root, mode);
  if (mode === '2d-draw' && canvas.width !== content.width) canvas.width = canvas.height = content.width;
  const stats: RecaptureStats = { count: 0, cpuMs: [], gpuMs: [] };
  const push = (arr: number[], v: number): void => {
    arr.push(Math.round(v * 100) / 100);
    if (arr.length > RECAPTURE_SAMPLES) arr.shift();
  };
  let wanted = false;
  let tick = 0,
    copiedTick = -1;
  const frame = (): void => {
    tick++;
    if (!fatalShown()) requestAnimationFrame(frame); // the render loop stops on a fatal error, and so does this
  };
  requestAnimationFrame(frame);
  const onPaint = (ev: Event): void => {
    const listed = ((ev as PaintEvent).changedElements ?? []).includes(root);
    if (!wanted && !listed) return;
    if (copiedTick === tick) {
      wanted = true;
      requestAnimationFrame(() => canvas.requestPaint?.());
      return;
    }
    wanted = false;
    copiedTick = tick;
    let before = 0;
    void device.queue.onSubmittedWorkDone().then(() => {
      before = performance.now();
    });
    const t0 = performance.now();
    try {
      copy(content);
      generateMips(device, content);
    } catch (err) {
      // One failed re-capture keeps the previous texture rather than ending the demo.
      console.warn('[dozer] re-capture failed; keeping the previous capture:', err);
      return;
    }
    const cpu = performance.now() - t0;
    stats.count++;
    push(stats.cpuMs, cpu);
    onCost?.(cpu);
    // GPU cost ≈ from the moment the work queued before the copy is done until the copy and the mips are done.
    void device.queue.onSubmittedWorkDone().then(() => push(stats.gpuMs, performance.now() - Math.max(before, t0)));
  };
  canvas.addEventListener('paint', onPaint);
  return {
    request() {
      wanted = true;
      canvas.requestPaint?.();
    },
    stats: () => ({ count: stats.count, cpuMs: [...stats.cpuMs], gpuMs: [...stats.gpuMs] }),
  };
}
