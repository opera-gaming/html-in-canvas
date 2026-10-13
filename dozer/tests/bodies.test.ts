// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { it, expect } from 'vitest';
import {
  packBodies,
  FLAG_ACTIVE,
  FLAG_ASLEEP,
  FLAG_WORD,
  FLAG_SCOOPED,
  PROPS_F32,
  SHAPE_F32,
  MOTION_F32,
} from '../src/bodies';
import commonWgsl from '../src/shaders/common.wgsl?raw';
import { signedArea, type V2 } from '../src/geom';

it('packs bodies and zeroes spare slots', () => {
  const p = packBodies([{ cx: 100, cy: 50, w: 10, h: 10, u0: 0, v0: 0, u1: 0.1, v1: 0.1, word: true }], 4);
  expect(p.count).toBe(1);
  expect(Array.from(p.pose.slice(0, 3))).toEqual([100, 50, 0]);
  expect(Array.from(p.shape.slice(0, 2))).toEqual([-5, -5]);
  expect(p.shape[8 + 4]).toBeCloseTo(0.1); // uv[2].x
  const flags = new Uint32Array(p.props.buffer);
  expect(flags[3]).toBe(FLAG_ACTIVE | FLAG_ASLEEP | FLAG_WORD);
  expect(flags[PROPS_F32 + 3]).toBe(0);
  expect(p.props[0]).toBeCloseTo(1); // invMass of 10x10
  expect(p.shape.length).toBe(4 * SHAPE_F32);
});
it('throws if bodies exceed capacity', () => {
  const b = { cx: 0, cy: 0, w: 2, h: 2, u0: 0, v0: 0, u1: 0, v1: 0, word: true };
  expect(() => packBodies([b, b], 1)).toThrow(/capacity/);
});

it('motion starts at rest with prevPos/prevAngle equal to the initial pose', () => {
  const p = packBodies([{ cx: 30, cy: 70, w: 20, h: 6, u0: 0, v0: 0, u1: 0, v1: 0, word: false }], 2);
  expect(p.motion.length).toBe(2 * MOTION_F32);
  // vel.xy, angVel, prevAngle, prevPos.xy, pad, pad
  expect(Array.from(p.motion.slice(0, MOTION_F32))).toEqual([0, 0, 0, 0, 30, 70, 0, 0]);
  expect(Array.from(p.motion.slice(MOTION_F32))).toEqual(new Array(MOTION_F32).fill(0));
  const flags = new Uint32Array(p.props.buffer);
  expect(flags[3]).toBe(FLAG_ACTIVE | FLAG_ASLEEP);
});
it('packed shape verts have positive winding and props match the shape formulas', () => {
  const p = packBodies([{ cx: 0, cy: 0, w: 20, h: 6, u0: 0.1, v0: 0.2, u1: 0.3, v1: 0.4, word: false }], 1);
  const v: V2[] = [0, 1, 2, 3].map((i) => [p.shape[i * 2]!, p.shape[i * 2 + 1]!]);
  expect(signedArea(v)).toBeGreaterThan(0);
  expect(Array.from(p.shape.slice(8, 16)).map((x) => +x.toFixed(5))).toEqual([0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.1, 0.4]);
  const invMass = 100 / 120;
  expect(p.props[0]).toBeCloseTo(invMass);
  expect(p.props[1]).toBeCloseTo(invMass / ((400 + 36) / 12));
  expect(p.props[2]).toBeCloseTo(Math.hypot(20, 6) / 2);
});

it('FLAG_SCOOPED is bit 8 in both TS and WGSL, and packed bodies start unscooped', () => {
  expect(FLAG_SCOOPED).toBe(8);
  expect(commonWgsl).toMatch(/FLAG_SCOOPED: u32 = 8u/);
});
