// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Engine load: one smoothed 0..1 signal from the dozer's motion, shared by the exhaust smoke (smoke.ts) and the
// engine sound (audio.ts).
import { DOZER, type DozerState } from './dozer';

/** Weight of turning (|ω| / turnRate) in the load: tank steering works the engine even on the spot. */
const TURN_WEIGHT = 0.6;
/** Load ramp time constant (s): load approaches its target with 1 − exp(−dt / LOAD_RAMP). */
export const LOAD_RAMP = 0.3;

/** Instantaneous engine load in [0, 1]: |speed| / maxSpeed plus the turning share. */
export function engineLoadTarget(s: DozerState): number {
  const v = Math.abs(s.speed) / DOZER.maxSpeed + (TURN_WEIGHT * Math.abs(s.angVel)) / DOZER.turnRate;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** One smoothing step of the load toward `target` over `dt` seconds (frame-rate independent). */
export function smoothLoad(load: number, target: number, dt: number): number {
  return load + (target - load) * (1 - Math.exp(-Math.max(0, dt) / LOAD_RAMP));
}
