// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Fixed-step clock: the simulation always advances in FIXED_DT steps, independent of the display rate.

/** Simulation step (s). TUNING (gpu/sim.ts) is expressed per second, so it holds at this step. */
export const FIXED_DT = 1 / 60;
/** Most steps run per rendered frame; time beyond that is dropped (slow frames run the world in slow motion). */
export const MAX_SUBSTEPS = 2;

export interface Stepper {
  /** Adds `rawDt` seconds of wall time and returns how many fixed steps to run now (0..maxSteps). */
  advance(rawDt: number): number;
  /** Drops any accumulated time. */
  reset(): void;
}

export function createStepper(dt = FIXED_DT, maxSteps = MAX_SUBSTEPS): Stepper {
  let acc = 0;
  return {
    advance(rawDt) {
      acc += Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;
      // The epsilon keeps a 1/60 s frame from rounding down to 0 steps.
      let n = Math.floor(acc / dt + 1e-6);
      if (n > maxSteps) {
        n = maxSteps;
        acc = 0;
      } else {
        acc = Math.max(0, acc - n * dt);
      }
      return n;
    },
    reset() {
      acc = 0;
    },
  };
}
