// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Scripted intro: at boot and on R the dozer starts fully off the left edge of the page, facing right (+x), drives
// in, pushes into the text for a short distance and brakes to a stop. A pure state machine: each fixed step it
// produces the DozerInput to feed stepDozer and whether the page walls apply yet.
import { DOZER, dozerExtents, type DozerInput, type DozerState } from './dozer';

export const INTRO = {
  /** Seconds the dozer idles off-page before rolling, so the page is seen first. */
  idle: 0.6,
  /** Cruise speed (px/s), about 60 % of DOZER.maxSpeed. */
  cruise: 160,
  /** How far (px) the blade tip travels past the start of the text before the dozer stops. */
  push: 420,
  /** Gap (px) between the blade tip and the page's left edge at the start. */
  startGap: 24,
  /** Seconds the stopped dozer waits before the intro is done (and the key hint appears). */
  settle: 0.4,
};

/**
 * Where the intro runs, in page px: the dozer centre's start (startX: blade tip startGap left of the page), the lane
 * y, the centre x where the whole footprint has just entered the page (entryX: rear edge on the left wall; walls apply
 * from there on), and the centre x it stops at (stopX: blade tip INTRO.push px past the text's left edge).
 */
export interface IntroPlan {
  startX: number;
  y: number;
  entryX: number;
  stopX: number;
}

export type IntroPhase = 'idle' | 'drive' | 'brake' | 'settle' | 'done';

/** t = seconds in the current phase; walls = the footprint has been fully inside the page (latched). */
export interface IntroState {
  phase: IntroPhase;
  t: number;
  walls: boolean;
  skipped: boolean;
}

const NO_INPUT: DozerInput = { throttle: 0, steer: 0, brake: false };

/**
 * Plans the intro along a lane of text: `left` = page x where the text starts, `y` = the lane's centre line. `pageSize`
 * keeps the footprint's y inside the page.
 */
export function planIntro(lane: { left: number; y: number }, pageSize: number): IntroPlan {
  const e = dozerExtents(); // facing +x, the dozer-local extents are the world extents
  const startX = -e.maxX - INTRO.startGap;
  const entryX = -e.minX;
  const stopX = Math.max(entryX, lane.left + INTRO.push - e.maxX);
  const y = Math.min(pageSize - e.maxY, Math.max(-e.minY, lane.y));
  return { startX, y, entryX, stopX };
}

/** The dozer at the intro's start: off-page left, facing right, at rest. */
export function introDozer(plan: IntroPlan): DozerState {
  return { x: plan.startX, y: plan.y, angle: 0, speed: 0, angVel: 0, vx: 0, vy: 0, wallTurn: 0 };
}

export function initialIntro(): IntroState {
  return { phase: 'idle', t: 0, walls: false, skipped: false };
}

/** True while the intro owns the dozer (keyboard input is ignored). */
export const introActive = (s: IntroState): boolean => s.phase !== 'done';

/**
 * One fixed step of the intro for the dozer state `d` (before this step). Returns the next intro state, the input to
 * step the dozer with and whether walls apply this step. Once done it returns no input and walls on (main.ts then
 * drives the dozer from the keyboard).
 */
type IntroStepResult = { state: IntroState; input: DozerInput; walls: boolean };

export function introStep(s: IntroState, d: DozerState, dt: number, plan: IntroPlan): IntroStepResult {
  const walls = s.walls || d.x >= plan.entryX;
  const t = s.t + dt;
  const next = (phase: IntroPhase, input: DozerInput, keepT = false): IntroStepResult => ({
    state: { ...s, phase, t: keepT ? t : 0, walls },
    input,
    walls,
  });
  switch (s.phase) {
    case 'idle':
      return t >= INTRO.idle ? next('drive', NO_INPUT) : next('idle', NO_INPUT, true);
    case 'drive': {
      // Brake when the stopping distance at the next step's position would reach stopX.
      const v = Math.max(0, d.speed);
      const stopping = (v * v) / (2 * DOZER.brakeDecel);
      if (d.x + v * dt + stopping >= plan.stopX) return next('brake', { ...NO_INPUT, brake: true });
      return next('drive', { ...NO_INPUT, throttle: v < INTRO.cruise ? 1 : 0 }, true);
    }
    case 'brake':
      return d.speed === 0 ? next('settle', NO_INPUT) : next('brake', { ...NO_INPUT, brake: true }, true);
    case 'settle':
      return t >= INTRO.settle ? next('done', NO_INPUT) : next('settle', NO_INPUT, true);
    case 'done':
      return { state: { ...s, walls: true }, input: NO_INPUT, walls: true };
  }
}

/**
 * Skips the intro (a key press during it): the intro is done, and a dozer still (partly) off-page is moved straight
 * in to entryX so the walls can apply at once. A dozer already inside keeps its pose and speed.
 */
export function skipIntro(s: IntroState, d: DozerState, plan: IntroPlan): { state: IntroState; dozer: DozerState } {
  if (!introActive(s)) return { state: s, dozer: d };
  const dozer = d.x >= plan.entryX ? d : { ...d, x: plan.entryX };
  return { state: { phase: 'done', t: 0, walls: true, skipped: true }, dozer };
}
