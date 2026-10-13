// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { detectCapabilities } from '../src/capabilities';

const gpuQueue = { copyElementImageToTexture() {} };
const canvasProto = { requestPaint() {} };
const ctx2d = { drawElementImage() {} };

describe('detectCapabilities', () => {
  it('prefers the GPU copy path and lists the 2D path as a fallback', () => {
    const r = detectCapabilities({ gpu: {}, canvasProto, queueProto: gpuQueue, ctx2dProto: ctx2d });
    expect(r).toEqual({
      webgpu: true,
      htmlInCanvas: 'gpu-copy',
      captureStrategies: ['gpu-copy', '2d-draw'],
      problems: [],
    });
  });
  it('falls back to 2D drawElementImage', () => {
    const r = detectCapabilities({ gpu: {}, canvasProto, queueProto: {}, ctx2dProto: ctx2d });
    expect(r.htmlInCanvas).toBe('2d-draw');
    expect(r.captureStrategies).toEqual(['2d-draw']);
  });
  it('does not require requestPaint (Opera GX 152 may lack it)', () => {
    const gpu = detectCapabilities({ gpu: {}, canvasProto: {}, queueProto: gpuQueue, ctx2dProto: null });
    expect(gpu.htmlInCanvas).toBe('gpu-copy');
    expect(gpu.problems).toEqual([]);
    const draw = detectCapabilities({ gpu: {}, canvasProto: {}, queueProto: null, ctx2dProto: ctx2d });
    expect(draw.htmlInCanvas).toBe('2d-draw');
    expect(draw.problems).toEqual([]);
  });
  it('reports missing WebGPU with hardware-acceleration guidance', () => {
    const r = detectCapabilities({ gpu: undefined, canvasProto, queueProto: null, ctx2dProto: ctx2d });
    expect(r.webgpu).toBe(false);
    expect(r.problems.join(' ')).toMatch(/WebGPU/);
    expect(r.problems.join(' ')).toMatch(/hardware acceleration/);
    expect(r.problems.join(' ')).toMatch(/opera:\/\/gpu/);
  });
  it('reports missing HTML-in-Canvas with the flag name only when neither capture call exists', () => {
    const r = detectCapabilities({ gpu: {}, canvasProto, queueProto: {}, ctx2dProto: {} });
    expect(r.htmlInCanvas).toBeNull();
    expect(r.captureStrategies).toEqual([]);
    expect(r.problems.join(' ')).toMatch(/canvas-draw-element/);
  });
});
