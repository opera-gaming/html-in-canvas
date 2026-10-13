// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { createSmoke, SMOKE, SMOKE_INSTANCE_F32 } from '../src/smoke';
import { engineLoadTarget, smoothLoad } from '../src/engine';
import { DOZER, initialDozer } from '../src/dozer';

const run = (load: number, secs: number) => {
  const s = createSmoke();
  for (let k = 0; k < secs * 60; k++) s.step(1 / 60, [100, 100], [0, 0], load);
  const out = new Float32Array(SMOKE.cap * SMOKE_INSTANCE_F32);
  const n = s.write(out);
  const at = (i: number, f: number) => out[i * SMOKE_INSTANCE_F32 + f]!;
  const mean = (f: number) => Array.from({ length: n }, (_, i) => at(i, f)).reduce((a, b) => a + b, 0) / n;
  return { s, n, grey: mean(4), alpha: mean(3), radius: mean(2) };
};

describe('smoke', () => {
  it('emits more, darker and thicker smoke under load than at idle', () => {
    const idle = run(0, 3),
      busy = run(1, 3);
    expect(busy.n).toBeGreaterThan(idle.n * 4);
    expect(busy.grey).toBeLessThan(idle.grey - 0.4);
    expect(busy.alpha).toBeGreaterThan(idle.alpha);
    expect(busy.radius).toBeGreaterThan(idle.radius);
  });
  it('never exceeds its ring and particles die out', () => {
    const s = createSmoke();
    for (let k = 0; k < 600; k++) s.step(1 / 60, [0, 0], [300, 0], 1);
    expect(s.live).toBeLessThanOrEqual(SMOKE.cap);
    for (let k = 0; k < 60 * 5; k++) s.step(1 / 60, [0, 0], [0, 0], Number.NaN); // NaN load: treated as idle
    const before = s.live;
    s.reset();
    expect(before).toBeGreaterThan(0);
    expect(s.live).toBe(0);
  });
  it('drifts with the wind', () => {
    const s = createSmoke(() => 0.5);
    s.step(1 / 60, [0, 0], [0, 0], 0);
    for (let k = 0; k < 120; k++) s.step(1 / 60, [0, 0], [0, 0], 0);
    const out = new Float32Array(SMOKE.cap * SMOKE_INSTANCE_F32);
    s.write(out);
    expect(Math.sign(out[0]!)).toBe(Math.sign(SMOKE.wind[0]));
    expect(Math.sign(out[1]!)).toBe(Math.sign(SMOKE.wind[1]));
  });
});

describe('engine load', () => {
  it('is 0 parked, 1 at full speed, and turning adds load', () => {
    const s = initialDozer(2048);
    expect(engineLoadTarget(s)).toBe(0);
    expect(engineLoadTarget({ ...s, speed: DOZER.maxSpeed })).toBe(1);
    expect(engineLoadTarget({ ...s, angVel: DOZER.turnRate * 0.5 })).toBeGreaterThan(0.2);
  });
  it('ramps independently of the step size', () => {
    let a = 0,
      b = 0;
    for (let k = 0; k < 30; k++) a = smoothLoad(a, 1, 1 / 60);
    for (let k = 0; k < 15; k++) b = smoothLoad(b, 1, 1 / 30);
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeGreaterThan(0.7);
  });
});
