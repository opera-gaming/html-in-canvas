// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { createStepper, FIXED_DT, MAX_SUBSTEPS } from '../src/stepper';

describe('createStepper', () => {
  it('runs one step per 60 Hz frame', () => {
    const s = createStepper();
    const steps = Array.from({ length: 120 }, () => s.advance(1 / 60));
    expect(steps.every((n) => n === 1)).toBe(true);
  });
  it('runs a step every other frame at 120 Hz, keeping the remainder', () => {
    const s = createStepper();
    const steps = Array.from({ length: 120 }, () => s.advance(1 / 120));
    expect(steps.reduce((a, b) => a + b, 0)).toBe(60);
    expect(Math.max(...steps)).toBe(1);
  });
  it('averages 60 steps per second at 144 Hz', () => {
    const s = createStepper();
    let total = 0;
    for (let i = 0; i < 144 * 10; i++) total += s.advance(1 / 144);
    expect(Math.abs(total - 600)).toBeLessThanOrEqual(1);
  });
  it('caps a slow frame at MAX_SUBSTEPS and drops the excess time', () => {
    const s = createStepper();
    expect(s.advance(1 / 9)).toBe(MAX_SUBSTEPS); // headless SwiftShader ~9 fps: 2/60 s simulated per frame
    expect(s.advance(0)).toBe(0); // nothing carried over
    expect(s.advance(1)).toBe(MAX_SUBSTEPS);
    expect(s.advance(1 / 60)).toBe(1);
  });
  it('ignores zero, negative and non-finite frame times', () => {
    const s = createStepper();
    expect(s.advance(0)).toBe(0);
    expect(s.advance(-1)).toBe(0);
    expect(s.advance(Number.NaN)).toBe(0);
    expect(s.advance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(s.advance(FIXED_DT)).toBe(1);
  });
  it('reset drops accumulated time', () => {
    const s = createStepper();
    expect(s.advance(FIXED_DT * 0.9)).toBe(0);
    s.reset();
    expect(s.advance(FIXED_DT * 0.5)).toBe(0);
    expect(s.advance(FIXED_DT * 0.6)).toBe(1);
  });
});
