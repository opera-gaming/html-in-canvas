// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import { satQuads, type V2 } from '../src/geom';
const box = (cx: number, cy: number, w: number, h: number): V2[] => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];
const r = (p: V2[], a: number): V2[] =>
  p.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

it('separated boxes do not collide', () => expect(satQuads(box(0, 0, 10, 10), box(20, 0, 10, 10))).toBeNull());
it('overlap along x gives x normal pointing from b to a', () => {
  const c = satQuads(box(0, 0, 10, 10), box(8, 0, 10, 10))!;
  expect(c.depth).toBeCloseTo(2);
  expect(c.normal[0]).toBeCloseTo(-1);
  expect(c.normal[1]).toBeCloseTo(0);
});
it('rotated overlap still finds minimum axis', () => {
  const c = satQuads(r(box(0, 0, 10, 10), 0.3), box(9, 0, 10, 10))!;
  expect(c.depth).toBeGreaterThan(0);
  expect(c.normal[0]).toBeLessThan(0);
});
it('overlap along y: normal points from b to a (a below b)', () => {
  const c = satQuads(box(0, 9, 20, 4), box(0, 0, 20, 16))!;
  expect(c.depth).toBeCloseTo(1);
  expect(c.normal[0]).toBeCloseTo(0);
  expect(c.normal[1]).toBeCloseTo(1);
});
it('contact point averages vertices inside the other polygon', () => {
  // a's right corners (5,±5) lie inside b; b's left corners (3,±5) lie on a's edge → counted as inside.
  const c = satQuads(box(0, 0, 10, 10), box(8, 0, 10, 10))!;
  expect(c.point[0]).toBeCloseTo(4);
  expect(c.point[1]).toBeCloseTo(0);
});
it('contact point falls back to the centre midpoint when no vertex is inside', () => {
  // A thin cross: neither polygon has a vertex inside the other.
  const c = satQuads(box(0, 0, 40, 4), box(1, 0, 4, 40))!;
  expect(c.depth).toBeCloseTo(21); // x: a must slide 21 left (or 23 right) to clear b
  expect(c.point[0]).toBeCloseTo(0.5);
  expect(c.point[1]).toBeCloseTo(0);
});
it('touching-only boxes are not a hit', () => expect(satQuads(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBeNull());
it('pushing a out along the normal by depth separates the pair', () => {
  const a = r(box(3, 2, 20, 6), 0.7),
    b = r(box(0, 0, 30, 8), -0.2);
  const c = satQuads(a, b)!;
  expect(c.depth).toBeGreaterThan(0);
  const moved = a.map(([x, y]): V2 => [x + c.normal[0] * (c.depth + 1e-3), y + c.normal[1] * (c.depth + 1e-3)]);
  expect(satQuads(moved, b)).toBeNull();
});
