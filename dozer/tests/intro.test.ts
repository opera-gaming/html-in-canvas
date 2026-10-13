// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  INTRO,
  initialIntro,
  introActive,
  introDozer,
  introStep,
  planIntro,
  skipIntro,
  type IntroState,
} from '../src/intro';
import { dozerExtents, dozerPolygons, stepDozer, type DozerState } from '../src/dozer';

const PAGE = 3072;
const DT = 1 / 60;
const lane = { left: 30, y: 400 };

/** Runs the intro to completion (or `maxSteps`), recording every step. */
function run(maxSteps = 60 * 20) {
  const plan = planIntro(lane, PAGE);
  let d: DozerState = introDozer(plan);
  let s: IntroState = initialIntro();
  const log: { d: DozerState; s: IntroState; walls: boolean; steer: number }[] = [];
  let steps = 0;
  while (introActive(s) && steps < maxSteps) {
    const r = introStep(s, d, DT, plan);
    s = r.state;
    d = stepDozer(d, r.input, DT, PAGE, r.walls);
    log.push({ d, s, walls: r.walls, steer: r.input.steer });
    steps++;
  }
  return { plan, d, s, log, steps };
}

const footprintMinX = (d: DozerState): number =>
  Math.min(
    ...Object.values(dozerPolygons(d))
      .flat()
      .map((p) => p[0]),
  );

describe('intro', () => {
  it('starts with the whole dozer off the left edge, facing right', () => {
    const plan = planIntro(lane, PAGE);
    const d = introDozer(plan);
    expect(d.angle).toBe(0);
    expect(d.speed).toBe(0);
    expect(d.x + dozerExtents().maxX).toBeLessThan(0);
    expect(d.y).toBe(lane.y);
  });

  it('drives in, pushes into the text and stops inside the page within 4–6 s', () => {
    const { plan, d, s, steps } = run();
    expect(s.phase).toBe('done');
    expect(s.skipped).toBe(false);
    const seconds = steps * DT;
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThanOrEqual(6);
    expect(d.speed).toBe(0);
    expect(d.angle).toBe(0);
    expect(d.y).toBe(lane.y);
    // Stops close to the planned spot: the blade tip ~INTRO.push px past the start of the text.
    expect(Math.abs(d.x - plan.stopX)).toBeLessThan(8);
    const pushed = d.x + dozerExtents().maxX - lane.left;
    expect(pushed).toBeGreaterThanOrEqual(300);
    expect(pushed).toBeLessThanOrEqual(500);
    expect(footprintMinX(d)).toBeGreaterThanOrEqual(0);
  });

  it('keeps a moderate speed and never steers', () => {
    const { log } = run();
    const top = Math.max(...log.map((e) => e.d.speed));
    expect(top).toBeGreaterThan(INTRO.cruise * 0.9);
    expect(top).toBeLessThan(INTRO.cruise + 10);
    expect(log.every((e) => e.steer === 0)).toBe(true);
  });

  it('ignores the walls until the whole footprint is inside, then keeps them on', () => {
    const { log } = run();
    const first = log.findIndex((e) => e.walls);
    expect(first).toBeGreaterThan(0);
    expect(log.slice(first).every((e) => e.walls)).toBe(true);
    // Walls switch on only once the footprint had fully entered the page.
    expect(footprintMinX(log[first - 1]!.d)).toBeGreaterThanOrEqual(-1e-9);
    expect(log.slice(0, first - 1).some((e) => footprintMinX(e.d) < 0)).toBe(true);
  });

  it('skips off-page by moving the dozer to the entry point with walls on', () => {
    const plan = planIntro(lane, PAGE);
    const d = { ...introDozer(plan), speed: 50 };
    const r = skipIntro(initialIntro(), d, plan);
    expect(r.state).toMatchObject({ phase: 'done', skipped: true, walls: true });
    expect(r.dozer.x).toBe(plan.entryX);
    expect(r.dozer.speed).toBe(50);
    expect(footprintMinX(r.dozer)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('skips inside the page without moving the dozer, and is a no-op once done', () => {
    const plan = planIntro(lane, PAGE);
    const d = { ...introDozer(plan), x: plan.entryX + 50, speed: 120 };
    const r = skipIntro({ phase: 'drive', t: 0, walls: true, skipped: false }, d, plan);
    expect(r.dozer).toEqual(d);
    expect(skipIntro(r.state, d, plan).state).toBe(r.state);
  });

  it('gives no input once done', () => {
    const plan = planIntro(lane, PAGE);
    const r = introStep({ phase: 'done', t: 0, walls: true, skipped: false }, introDozer(plan), DT, plan);
    expect(r.input).toEqual({ throttle: 0, steer: 0, brake: false });
    expect(r.walls).toBe(true);
  });

  it('keeps the lane inside the page vertically and the stop point past the entry point', () => {
    const e = dozerExtents();
    expect(planIntro({ left: 0, y: 5 }, PAGE).y).toBe(-e.minY);
    expect(planIntro({ left: 0, y: PAGE }, PAGE).y).toBe(PAGE - e.maxY);
    const p = planIntro({ left: -1000, y: 400 }, PAGE);
    expect(p.stopX).toBe(p.entryX);
  });
});
