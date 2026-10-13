// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import { viewMatrix, viewWidthFor, clampCamera } from '../src/camera';
const apply = (m: Float32Array, x: number, y: number) => [m[0]! * x + m[4]! * y + m[8]!, m[1]! * x + m[5]! * y + m[9]!];
it('maps the view centre to clip origin and right edge to +1', () => {
  const m = viewMatrix([1000, 500], [1600, 800], 900);
  const [cx, cy] = apply(m, 1000, 500);
  expect(cx).toBeCloseTo(0, 5);
  expect(cy).toBeCloseTo(0, 5);
  const [x] = apply(m, 1450, 500);
  expect(x).toBeCloseTo(1);
  const [, y] = apply(m, 1000, 500 + 225);
  expect(y).toBeCloseTo(-1); // 900 wide * 800/1600 tall = 450 tall; y down
});

it('is a padded mat3x3 (12 floats) with homogeneous row (0,0,1)', () => {
  const m = viewMatrix([0, 0], [100, 100], 100);
  expect(m.length).toBe(12);
  expect([m[2], m[6], m[10]]).toEqual([0, 0, 1]);
  expect([m[3], m[7], m[11]]).toEqual([0, 0, 0]);
});
it('maps the top-left of the view to (-1, +1)', () => {
  const m = viewMatrix([1024, 1024], [1280, 800], 900);
  const [x, y] = apply(m, 1024 - 450, 1024 - (900 * 800) / 1280 / 2);
  expect(x).toBeCloseTo(-1);
  expect(y).toBeCloseTo(1);
});
it('maps a fractional centre to clip origin', () => {
  const m = viewMatrix([1023.37, 811.9], [1280, 800], 900);
  const [x, y] = apply(m, 1023.37, 811.9);
  expect(x).toBeCloseTo(0, 5);
  expect(y).toBeCloseTo(0, 5);
});
it('limits the view width so the view never exceeds the page', () => {
  expect(viewWidthFor([1280, 800], 900, 2048)).toBe(900);
  expect(viewWidthFor([900, 1200], 900, 2048)).toBe(900);
  expect(viewWidthFor([100, 1000], 900, 2048)).toBeCloseTo(204.8);
  expect(viewWidthFor([1280, 800], 4000, 2048)).toBe(2048);
});
it('clamps the camera inside the page and centres oversized views', () => {
  expect(clampCamera([10, 2040], [900, 600], 2048)).toEqual([450, 1748]);
  expect(clampCamera([1000, 1000], [900, 600], 2048)).toEqual([1000, 1000]);
  expect(clampCamera([10, 10], [2048, 3000], 2048)).toEqual([1024, 1024]);
});
