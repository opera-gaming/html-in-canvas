// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** Page layout size in CSS px; world units = page px, UV = world / PAGE_SIZE. */
export const PAGE_SIZE = 3072;
/** Target content (body) texture resolution, rgba8unorm: 2 texels per CSS px, so text stays crisp when zoomed. */
export const TEX_SIZE = PAGE_SIZE * 2;
/** Target background texture resolution: 1 texel per CSS px (backgrounds are flat colour, so this saves memory). */
export const BG_TEX_SIZE = PAGE_SIZE;

export interface Config {
  /** Fixed body capacity, used when maxAuto is null. */
  maxBodies: number;
  /** When set, capacity = initial body count + maxAuto (resolved in main.ts). */
  maxAuto: number | null;
  /** Solver iterations per step. */
  iterations: number;
  debug: boolean;
  /**
   * `?prof`: GPU timestamps per sim stage and CPU frame timings (gpu/prof.ts, read via window.__dozerProf);
   * `?prof=coarse` times each sim step as one pass. null = off.
   */
  prof: 'stages' | 'coarse' | null;
  /** Live TUNING overrides from `?tune=key:value,key:value` (applied in sim.ts; unknown keys are ignored there). */
  tune: Record<string, number>;
}

const MAX_BODIES = { min: 1024, max: 262144, def: 32768 };
/**
 * Contact iterations per simulation step. TUNING assumes about 120 contact solves per simulated second (2 per 1/60 s
 * step); more makes heaps slump flat.
 */
const ITERATIONS = { min: 1, max: 16, def: 2 };

function parseUint(v: string | null): number | null {
  if (v === null || !/^\d+$/.test(v.trim())) return null;
  return Number(v.trim());
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function parseTune(v: string | null): Record<string, number> {
  const tune: Record<string, number> = {};
  for (const entry of (v ?? '').split(',')) {
    const m = /^\s*(\w+)\s*:\s*(-?\d*\.?\d+)\s*$/.exec(entry);
    if (m) tune[m[1]!] = Number(m[2]);
  }
  return tune;
}

export function readConfig(search: string): Config {
  const params = new URLSearchParams(search);
  let maxBodies = MAX_BODIES.def;
  let maxAuto: number | null = null;

  const max = params.get('max');
  // `auto+N`; an unencoded `+` in the query string decodes to a space.
  const auto = max === null ? null : /^auto[+ ](\d+)$/.exec(max.trim());
  if (auto) {
    maxAuto = Number(auto[1]);
  } else {
    const n = parseUint(max);
    if (n !== null) maxBodies = clamp(n, MAX_BODIES.min, MAX_BODIES.max);
  }

  const iter = parseUint(params.get('iter'));
  const iterations = iter === null ? ITERATIONS.def : clamp(iter, ITERATIONS.min, ITERATIONS.max);

  const prof = !params.has('prof') ? null : params.get('prof') === 'coarse' ? 'coarse' : 'stages';
  return { maxBodies, maxAuto, iterations, debug: params.has('debug'), prof, tune: parseTune(params.get('tune')) };
}
