// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { smoothstep, arcLift, lerpPose } from '../src/camera/tween';

describe('smoothstep', () => {
  it('is 0 at 0, 1 at 1, 0.5 at 0.5 and clamps', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });
});

describe('arcLift', () => {
  it('is zero at the ends and arc at the middle', () => {
    expect(arcLift(0, 0.2)).toBeCloseTo(0);
    expect(arcLift(1, 0.2)).toBeCloseTo(0);
    expect(arcLift(0.5, 0.2)).toBeCloseTo(0.2);
  });
});

describe('lerpPose', () => {
  const a = { position: new Vector3(0, 0, 0), quaternion: new Quaternion() };
  const b = {
    position: new Vector3(2, 0, 0),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
  };
  it('returns endpoints at t=0 and t=1', () => {
    const out = { position: new Vector3(), quaternion: new Quaternion() };
    lerpPose(a, b, 0, 0.5, out);
    expect(out.position.toArray()).toEqual([0, 0, 0]);
    lerpPose(a, b, 1, 0.5, out);
    expect(out.position.x).toBeCloseTo(2);
    expect(out.quaternion.angleTo(b.quaternion)).toBeCloseTo(0);
  });
  it('lifts the midpoint along +Y', () => {
    const out = { position: new Vector3(), quaternion: new Quaternion() };
    lerpPose(a, b, 0.5, 0.5, out);
    expect(out.position.x).toBeCloseTo(1);
    expect(out.position.y).toBeCloseTo(0.5);
  });
});
