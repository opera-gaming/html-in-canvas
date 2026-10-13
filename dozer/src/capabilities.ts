// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export type CaptureStrategy = 'gpu-copy' | '2d-draw';

export interface CapabilityReport {
  webgpu: boolean;
  /** Preferred capture path (the first of `captureStrategies`), or null when neither API exists. */
  htmlInCanvas: CaptureStrategy | null;
  /** Every capture path the browser exposes, preferred first (main.ts falls back along this list). */
  captureStrategies: CaptureStrategy[];
  problems: string[];
}

export interface CapabilityEnv {
  gpu: unknown;
  canvasProto: object;
  queueProto: object | null;
  ctx2dProto: object | null;
}

const NO_WEBGPU =
  'WebGPU is not available in this browser. Make sure hardware acceleration is enabled ' +
  '(Settings → System → "Use hardware acceleration when available") and check opera://gpu ' +
  '(or chrome://gpu) that WebGPU is listed as "Hardware accelerated".';
const NO_HTML_IN_CANVAS =
  'HTML-in-Canvas is not enabled: turn on opera://flags/#canvas-draw-element ' +
  '(or chrome://flags/#canvas-draw-element) and relaunch.';

function hasFn(obj: object | null, name: string): boolean {
  return obj !== null && typeof (obj as Record<string, unknown>)[name] === 'function';
}

/**
 * Pure feature detection over the given prototypes. `requestPaint` is optional: some builds (e.g. Opera GX 152) ship
 * the capture calls without it, and capture.ts then waits for a natural paint.
 */
export function detectCapabilities(env: CapabilityEnv): CapabilityReport {
  const webgpu = !!env.gpu;
  const captureStrategies: CaptureStrategy[] = [];
  if (hasFn(env.queueProto, 'copyElementImageToTexture')) captureStrategies.push('gpu-copy');
  if (hasFn(env.ctx2dProto, 'drawElementImage')) captureStrategies.push('2d-draw');
  const htmlInCanvas = captureStrategies[0] ?? null;

  const problems: string[] = [];
  if (!webgpu) problems.push(NO_WEBGPU);
  if (!htmlInCanvas) problems.push(NO_HTML_IN_CANVAS);
  return { webgpu, htmlInCanvas, captureStrategies, problems };
}

/** Browser wrapper: requests a throwaway adapter/device to inspect GPUQueue. */
export async function probeEnvironment(): Promise<CapabilityReport> {
  let gpu: unknown = navigator.gpu;
  let queueProto: object | null = null;
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('no adapter');
      const device = await adapter.requestDevice();
      queueProto = Object.getPrototypeOf(device.queue) as object;
      try {
        device.destroy();
      } catch (err) {
        console.warn('[dozer] probe device.destroy() failed (ignored)', err);
      }
    } catch (err) {
      console.warn('[dozer] WebGPU probe failed', err);
      gpu = undefined;
    }
  }
  return detectCapabilities({
    gpu,
    canvasProto: HTMLCanvasElement.prototype,
    queueProto,
    ctx2dProto: typeof CanvasRenderingContext2D === 'undefined' ? null : CanvasRenderingContext2D.prototype,
  });
}
