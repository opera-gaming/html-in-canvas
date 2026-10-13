// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { showFatal } from '../fatal';

export interface Gpu {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

/**
 * Requests a high-performance device with the adapter's full buffer limits, configures
 * `canvas` as an opaque WebGPU surface and keeps its backing store at device-pixel size.
 */
export async function initGpu(
  canvas: HTMLCanvasElement,
  /** Optional device features to request (`?prof`: timestamp-query when the adapter has it). */
  features?: (adapter: GPUAdapter) => GPUFeatureName[],
): Promise<Gpu> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU: no adapter available');
  const device = await adapter.requestDevice({
    requiredFeatures: features?.(adapter) ?? [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  void device.lost.then((info) => {
    console.error(`[dozer] GPU device lost (${info.reason}): ${info.message}`);
    if (info.reason !== 'destroyed') showFatal('The GPU device was lost', [info.message || String(info.reason)]);
  });
  device.addEventListener('uncapturederror', (ev) => {
    console.error(`[dozer] WebGPU error: ${(ev as GPUUncapturedErrorEvent).error.message}`);
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU: canvas has no webgpu context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const maxDim = device.limits.maxTextureDimension2D;
  const setSize = (w: number, h: number): void => {
    canvas.width = Math.max(1, Math.min(maxDim, Math.round(w)));
    canvas.height = Math.max(1, Math.min(maxDim, Math.round(h)));
  };
  const r = canvas.getBoundingClientRect();
  setSize(r.width * devicePixelRatio, r.height * devicePixelRatio);
  new ResizeObserver(([entry]) => {
    if (!entry) return;
    const dp = entry.devicePixelContentBoxSize?.[0];
    if (dp) setSize(dp.inlineSize, dp.blockSize);
    else {
      const css = entry.contentBoxSize[0];
      if (css) setSize(css.inlineSize * devicePixelRatio, css.blockSize * devicePixelRatio);
    }
  }).observe(canvas);

  return { device, context, format };
}
