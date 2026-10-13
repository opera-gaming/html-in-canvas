// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Exhaust smoke: a fixed ring of CPU particles (no allocation after creation), stepped at the simulation's fixed
// step and drawn as instanced soft round sprites above everything (render.ts, render.wgsl fs_smoke).
import type { V2 } from './geom';

/** Smoke constants (world px, seconds). Rates and looks blend from idle to full load (engine.ts). */
export const SMOKE = {
  /** Ring capacity: the oldest particle is overwritten when it is full. */
  cap: 320,
  /** Particles per second at idle / at full load. */
  idleRate: 9,
  loadRate: 45,
  /** Lifetime range (s); loaded puffs live a little longer. */
  lifeMin: 1.4,
  lifeMax: 2.4,
  /** Radius at emission (px), idle / full load. */
  sizeIdle: 3,
  sizeLoad: 6,
  /** Radius growth (px/s), idle / full load: the smoke "rises" toward the viewer and spreads. */
  growIdle: 7,
  growLoad: 14,
  /** Grey level (premultiplied colour = grey · alpha): light wisps at idle, dark puffs under load. */
  greyIdle: 0.8,
  greyLoad: 0.18,
  /** Peak opacity, idle / full load. */
  alphaIdle: 0.4,
  alphaLoad: 0.62,
  /** Wind (px/s) that every particle relaxes toward, at windRate (1/s). */
  wind: [14, -9] as V2,
  windRate: 1.2,
  /** Share of the exhaust's own velocity a particle starts with. */
  inherit: 0.6,
  /** Random extra start speed (px/s). */
  spread: 7,
};

/** Floats per particle in the instance buffer: x, y, radius, alpha, grey, seed, -, -. */
export const SMOKE_INSTANCE_F32 = 8;

export interface Smoke {
  /** Advances every particle by dt and emits at `emitter` (world px), which moves at `emitterVel`, for `load` 0..1. */
  step(dt: number, emitter: V2, emitterVel: V2, load: number): void;
  /** Fills the instance buffer with the live particles; returns how many. */
  write(out: Float32Array): number;
  readonly live: number;
  reset(): void;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** `rand` (0..1) is injectable for tests; defaults to a small deterministic LCG. */
export function createSmoke(rand?: () => number): Smoke {
  let seed = 0x2f6b1d;
  const rnd =
    rand ??
    ((): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
  const n = SMOKE.cap;
  const x = new Float32Array(n),
    y = new Float32Array(n),
    vx = new Float32Array(n),
    vy = new Float32Array(n);
  const age = new Float32Array(n),
    life = new Float32Array(n),
    r0 = new Float32Array(n),
    grow = new Float32Array(n);
  const grey = new Float32Array(n),
    a0 = new Float32Array(n),
    sd = new Float32Array(n);
  let head = 0,
    accum = 0;
  const alive = (i: number): boolean => age[i]! < life[i]!;
  const emit = (e: V2, ev: V2, load: number): void => {
    const i = head;
    head = (head + 1) % n;
    const ang = rnd() * Math.PI * 2,
      sp = rnd() * SMOKE.spread;
    x[i] = e[0] + (rnd() - 0.5);
    y[i] = e[1] + (rnd() - 0.5);
    vx[i] = ev[0] * SMOKE.inherit + Math.cos(ang) * sp;
    vy[i] = ev[1] * SMOKE.inherit + Math.sin(ang) * sp;
    age[i] = 0;
    life[i] = lerp(SMOKE.lifeMin, SMOKE.lifeMax, rnd()) * (1 + 0.25 * load);
    r0[i] = lerp(SMOKE.sizeIdle, SMOKE.sizeLoad, load) * lerp(0.8, 1.2, rnd());
    grow[i] = lerp(SMOKE.growIdle, SMOKE.growLoad, load);
    grey[i] = lerp(SMOKE.greyIdle, SMOKE.greyLoad, load) + (rnd() - 0.5) * 0.06;
    a0[i] = lerp(SMOKE.alphaIdle, SMOKE.alphaLoad, load);
    sd[i] = rnd() * 64;
  };
  return {
    step(dt, emitter, emitterVel, load) {
      if (!(dt > 0)) return;
      const l = Math.min(1, Math.max(0, Number.isFinite(load) ? load : 0));
      const k = 1 - Math.exp(-SMOKE.windRate * dt);
      for (let i = 0; i < n; i++) {
        if (!alive(i)) continue;
        age[i]! += dt;
        vx[i]! += (SMOKE.wind[0] - vx[i]!) * k;
        vy[i]! += (SMOKE.wind[1] - vy[i]!) * k;
        x[i]! += vx[i]! * dt;
        y[i]! += vy[i]! * dt;
      }
      accum += lerp(SMOKE.idleRate, SMOKE.loadRate, l) * dt;
      for (; accum >= 1; accum -= 1) emit(emitter, emitterVel, l);
    },
    write(out) {
      let c = 0;
      for (let i = 0; i < n; i++) {
        if (!alive(i)) continue;
        const t = age[i]! / life[i]!;
        const o = c * SMOKE_INSTANCE_F32;
        out[o] = x[i]!;
        out[o + 1] = y[i]!;
        out[o + 2] = r0[i]! + grow[i]! * age[i]!;
        // Quick fade-in, then out as (1 − t)^1.5.
        out[o + 3] = a0[i]! * Math.min(1, age[i]! / 0.12) * Math.pow(1 - t, 1.5);
        out[o + 4] = grey[i]!;
        out[o + 5] = sd[i]!;
        c++;
      }
      return c;
    },
    get live() {
      let c = 0;
      for (let i = 0; i < n; i++) if (alive(i)) c++;
      return c;
    },
    reset() {
      life.fill(0);
      age.fill(0);
      accum = 0;
    },
  };
}
