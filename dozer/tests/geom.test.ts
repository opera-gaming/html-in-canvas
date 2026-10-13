// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import { signedArea, centroid, cutQuad, chooseCut, isConvex, inertiaPerMass, type Quad } from '../src/geom';

const rect = (w: number, h: number): Quad => ({
  v: [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ],
  uv: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
});

it('area and centroid of a rect', () => {
  expect(Math.abs(signedArea(rect(10, 4).v))).toBeCloseTo(40);
  expect(centroid(rect(10, 4).v)).toEqual([0, 0]);
});
it('cut halves are convex, areas sum, UVs interpolate', () => {
  const [a, b] = cutQuad(rect(100, 20), 0, 0.3, 0.6);
  expect(isConvex(a.v) && isConvex(b.v)).toBe(true);
  expect(Math.abs(signedArea(a.v)) + Math.abs(signedArea(b.v))).toBeCloseTo(2000);
  expect(a.v[0]).toEqual([-20, -10]); // P on top edge at t=.3
  expect(a.uv[0]).toEqual([0.3, 0]);
  expect(a.v[3][0]).toBeCloseTo(-10); // Q' on bottom edge (v2->v3) at t=.6 : 50 + .6*(-100) = -10
  expect(a.uv[3][0]).toBeCloseTo(0.4);
});
it('long words are cut across the long axis', () => {
  const c = chooseCut(rect(120, 16), true, 0, 0)!;
  expect(c.edge).toBe(0); // edges 0 and 2 are the long (top/bottom) edges
});
it('short bodies never break', () => {
  expect(chooseCut(rect(27, 14), true, 0, 0)).toBeNull();
});
it('rejects cuts that leave tiny fragments', () => {
  expect(chooseCut(rect(30, 2), true, 0, 0)).toBeNull(); // halves 15x2 = 30 < 80 px²
  expect(chooseCut(rect(28, 12), true, -1, -1)).toBeNull(); // t=0.2 → 5.6 px < 10
});
it('accepts a normal word cut', () => {
  expect(chooseCut(rect(80, 16), true, 0.2, -0.2)).not.toBeNull();
});

it('the canonical rect winding has positive signed area', () => {
  expect(signedArea(rect(10, 4).v)).toBeCloseTo(40);
});
it('cut halves preserve the input (positive) winding on both edge choices', () => {
  for (const edge of [0, 1] as const) {
    const [a, b] = cutQuad(rect(60, 40), edge, 0.35, 0.7);
    expect(signedArea(a.v)).toBeGreaterThan(0);
    expect(signedArea(b.v)).toBeGreaterThan(0);
    expect(signedArea(a.v) + signedArea(b.v)).toBeCloseTo(2400);
  }
});
it('tall objects are cut across their long (vertical) axis', () => {
  const c = chooseCut(rect(20, 120), false, 0, 0)!;
  expect(c.edge).toBe(1);
  expect(c.tA).toBeCloseTo(0.5);
});
it('t follows 0.5 + jitter*0.3', () => {
  const c = chooseCut(rect(200, 50), false, 1, -0.5)!;
  expect(c.tA).toBeCloseTo(0.8);
  expect(c.tB).toBeCloseTo(0.35);
});
it('inertiaPerMass of a rect about its centre is (w²+h²)/12', () => {
  expect(inertiaPerMass(rect(10, 4).v, [0, 0])).toBeCloseTo((100 + 16) / 12);
  // Parallel axis theorem: about a corner add d².
  expect(inertiaPerMass(rect(10, 4).v, [5, 2])).toBeCloseTo((100 + 16) / 12 + 29);
});
it('isConvex rejects a dart', () => {
  expect(
    isConvex([
      [0, 0],
      [10, 0],
      [2, 2],
      [0, 10],
    ]),
  ).toBe(false);
});

it('objects that are nearly square may be cut along either pair; long ones and words always across the long axis', () => {
  const sq = rect(60, 50);
  expect(chooseCut(sq, false, 0, 0, -1)!.edge).toBe(0);
  expect(chooseCut(sq, false, 0, 0, 1)!.edge).toBe(1);
  expect(chooseCut(sq, true, 0, 0, 1)!.edge).toBe(0); // words never flip
  const long = rect(120, 40);
  expect(chooseCut(long, false, 0, 0, 1)!.edge).toBe(0); // aspect 3: no flip, so no 120 × 20 slivers
});
