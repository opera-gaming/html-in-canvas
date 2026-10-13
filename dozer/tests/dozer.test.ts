// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  initialDozer,
  stepDozer,
  dozerPolygons,
  dozerExtents,
  DOZER,
  createKeyboard,
  BLADE_ART,
  artToLocal,
  spriteScale,
  DOZER_IMAGE,
  scoopDepths,
  trackSurfaceSpeed,
  treadOffset,
  TRACK_ART,
} from '../src/dozer';
import { isConvex, signedArea, type V2 } from '../src/geom';

const run = (n: number, input: any, s = initialDozer(2048)) => {
  for (let i = 0; i < n; i++) s = stepDozer(s, input, 1 / 60, 2048);
  return s;
};

it('drives forward (up) and caps speed', () => {
  const s = run(300, { throttle: 1, steer: 0, brake: false });
  expect(s.speed).toBeCloseTo(DOZER.maxSpeed, 0);
  expect(s.y).toBeLessThan(initialDozer(2048).y);
});
it('turns in place', () => {
  const s = run(30, { throttle: 0, steer: 1, brake: false });
  expect(s.angle).not.toBeCloseTo(initialDozer(2048).angle);
  expect(Math.hypot(s.vx, s.vy)).toBeLessThan(1);
});
it('never leaves the page and reports zero velocity into a wall', () => {
  const s = run(2000, { throttle: 1, steer: 0, brake: false });
  // Facing up, the blade's leading point (the cutting edge's right end), dozerExtents().maxX ahead, rests on the top wall.
  expect(s.y).toBeCloseTo(dozerExtents().maxX, 6);
  expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
  expect(Math.abs(s.vy)).toBeLessThan(1e-6);
});
it('keeps the whole footprint (blade included) inside the page while sweeping along a wall', () => {
  let s = run(400, { throttle: 1, steer: 0, brake: false }); // against the top wall
  for (let k = 0; k < 600; k++) {
    s = stepDozer(s, { throttle: 1, steer: k % 90 < 45 ? -1 : 1, brake: false }, 1 / 30, 2048);
    const c = Math.cos(s.angle),
      sn = Math.sin(s.angle);
    const edge = BLADE_ART.cuttingEdge
      .map(artToLocal)
      .map(([lx, ly]): V2 => [s.x + c * lx - sn * ly, s.y + sn * lx + c * ly]);
    const { chassis, blade, wing } = dozerPolygons(s);
    for (const [x, y] of [...chassis, ...blade, ...wing, ...edge]) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(2048 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(2048 + 1e-6);
    }
  }
});
describe('wall sliding', () => {
  const at = (x: number, y: number, angle: number) => ({ ...initialDozer(2048), x, y, angle, speed: DOZER.maxSpeed });
  const go = { throttle: 1, steer: 0, brake: false } as const;
  it('turns along the wall and keeps moving when it grazes it', () => {
    // Heading up-right at 30° off the top wall, starting just below it.
    let s = at(800, dozerExtents().maxX + 20, -Math.PI / 6);
    for (let i = 0; i < 180; i++) s = stepDozer(s, go, 1 / 60, 2048);
    expect(Math.abs(Math.sin(s.angle))).toBeLessThan(0.1); // aligned with the wall (heading ≈ +x)
    expect(Math.cos(s.angle)).toBeGreaterThan(0.9);
    expect(s.x).toBeGreaterThan(1000); // still travelling along it
    expect(s.speed).toBeGreaterThan(DOZER.maxSpeed * 0.5);
  });
  it('turns onto the wall smoothly (no jumps in turn rate, no on/off flicker)', () => {
    let s = at(800, dozerExtents().maxX + 20, -Math.PI / 6);
    let prevRate = 0,
      maxJerk = 0,
      flips = 0,
      prevSign = 0;
    for (let i = 0; i < 180; i++) {
      const a = s.angle;
      s = stepDozer(s, go, 1 / 60, 2048);
      const rate = (s.angle - a) * 60;
      maxJerk = Math.max(maxJerk, Math.abs(rate - prevRate));
      const sign = Math.abs(rate) > 1e-3 ? Math.sign(rate) : 0;
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) flips++;
      if (sign !== 0) prevSign = sign;
      prevRate = rate;
    }
    expect(maxJerk).toBeLessThan(0.35); // rad/s change per 1/60 s step
    expect(flips).toBe(0);
  });
  it('still stops when driven straight into the wall', () => {
    let s = at(800, dozerExtents().maxX + 20, -Math.PI / 2 + 0.1); // ~6° off head-on
    const a0 = s.angle;
    for (let i = 0; i < 180; i++) s = stepDozer(s, go, 1 / 60, 2048);
    expect(s.angle).toBeCloseTo(a0, 6);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(DOZER.maxSpeed * 0.15);
  });
  it('does not steer when reversing along a wall', () => {
    let s = { ...at(800, dozerExtents().maxX + 20, Math.PI / 2 + Math.PI / 6), speed: -DOZER.maxSpeed };
    const a0 = s.angle;
    for (let i = 0; i < 60; i++) s = stepDozer(s, { throttle: -1, steer: 0, brake: false }, 1 / 60, 2048);
    expect(Number.isFinite(s.angle)).toBe(true);
    expect(Math.abs(s.angle - a0)).toBeLessThan(Math.PI); // sanity: no spinning
  });
});
it('handles huge dt without exploding', () => {
  const s = stepDozer(initialDozer(2048), { throttle: 1, steer: 1, brake: false }, 5, 2048);
  expect(Number.isFinite(s.x)).toBe(true);
});
describe('art geometry', () => {
  // Several headings and positions, so the checks hold in world space, not just for the local frame.
  const states = [0, -Math.PI / 2, 0.7, 2.5, -2.9].map((angle, k) => ({
    ...initialDozer(2048),
    x: 500 + 200 * k,
    y: 900,
    angle,
  }));
  /** Dozer-local coords of world point p (x forward, +y = the driver's right). */
  const local = (s: ReturnType<typeof initialDozer>, [x, y]: V2): V2 => {
    const c = Math.cos(s.angle),
      sn = Math.sin(s.angle);
    return [(x - s.x) * c + (y - s.y) * sn, -(x - s.x) * sn + (y - s.y) * c];
  };
  /** Inside or on a convex quad with positive shoelace area. */
  const inside = (q: V2[], [x, y]: V2) =>
    q.every((a, k) => {
      const b = q[(k + 1) % 4]!;
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-6;
    });
  const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  it('maps dozer.png to about 230 × 126 world px', () => {
    expect(DOZER_IMAGE[0] * spriteScale).toBeCloseTo(230.4, 1);
    expect(DOZER_IMAGE[1] * spriteScale).toBeCloseTo(125.6, 1);
  });
  it('all quads are convex with positive (CCW) shoelace area on raw world coordinates', () => {
    for (const s of states) {
      const { chassis, blade, wing } = dozerPolygons(s);
      for (const q of [chassis, blade, wing]) {
        expect(q).toHaveLength(4);
        expect(signedArea(q)).toBeGreaterThan(0);
        expect(isConvex(q)).toBe(true);
      }
    }
  });
  it('blade and wing fronts are the push line, pushDepth thick', () => {
    const { blade, wing } = dozerPolygons(states[2]!);
    const len = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const q of [blade, wing]) expect(len(q[0]!, q[1]!)).toBeCloseTo(BLADE_ART.pushDepth * spriteScale, 6);
    const pl = BLADE_ART.pushLine.map(artToLocal);
    const lb = dozerPolygons({ ...states[0]!, x: 0, y: 0, angle: 0 });
    expect(lb.blade[1]![0]).toBeCloseTo(pl[0]![0], 6);
    expect(lb.blade[2]![1]).toBeCloseTo(pl[1]![1], 6);
    expect(lb.wing[2]![1]).toBeCloseTo(pl[2]![1], 6);
  });
  it('the blade right end leads: material spills off the left end', () => {
    for (const s of states) {
      const { chassis, blade, wing } = dozerPolygons(s);
      const fwd = (q: V2[]) => q.map((p) => local(s, p)[0]);
      expect(Math.max(...fwd([...blade, ...wing]))).toBeGreaterThan(Math.max(...fwd(chassis)));
      expect(Math.min(...fwd(chassis))).toBeLessThan(Math.min(...fwd(blade)));
      // Front face v1 (left end, local −y) → v2 (right end, local +y): the right end is further forward.
      const l = local(s, blade[1]!),
        r = local(s, blade[2]!);
      expect(l[1]).toBeLessThan(r[1]);
      expect(r[0]).toBeGreaterThan(l[0] + 15);
    }
  });
  it('the push line lies behind the cutting edge', () => {
    const d = scoopDepths();
    expect(d.blade).toBeGreaterThan(5);
    expect(d.wing).toBeGreaterThan(5);
    for (const s of states) {
      const { blade, wing } = dozerPolygons(s);
      const edge = BLADE_ART.cuttingEdge.map(artToLocal);
      // Every cutting-edge point is in front of the blade/wing front faces (along their front normals).
      for (const [q, pts] of [
        [blade, [edge[0]!, edge[1]!]],
        [wing, [edge[1]!, edge[2]!]],
      ] as [V2[], V2[]][]) {
        const a = local(s, q[1]!),
          b = local(s, q[0]!);
        const n: V2 = [
          (a[0] - b[0]) / Math.hypot(a[0] - b[0], a[1] - b[1]),
          (a[1] - b[1]) / Math.hypot(a[0] - b[0], a[1] - b[1]),
        ];
        for (const p of pts) expect((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]).toBeGreaterThan(5);
      }
    }
  });
  it('blade and wing meet at the bend, and the chassis outline closes on them', () => {
    for (const s of states) {
      const { chassis, blade, wing } = dozerPolygons(s);
      // The chassis outline's front corners lie inside the blade (left) and the wing (right) ...
      expect(inside(blade, chassis[1]!)).toBe(true);
      expect(inside(wing, chassis[2]!)).toBe(true);
      // ... and blade and wing share the bend point and overlap there, so the push line has no gap.
      expect(Math.hypot(blade[2]![0] - wing[1]![0], blade[2]![1] - wing[1]![1])).toBeLessThan(1e-9);
      expect(inside(wing, blade[3]!)).toBe(true);
      expect(inside(blade, lerp(wing[0]!, wing[1]!, 0.5)) || inside(wing, lerp(blade[2]!, blade[3]!, 0.5))).toBe(true);
    }
  });
  it('tread centrelines are symmetric about the origin, and the tracks counter-rotate when turning in place', () => {
    const l = treadOffset(TRACK_ART.leftTread),
      r = treadOffset(TRACK_ART.rightTread);
    expect(l).toBeLessThan(0);
    expect(r).toBeCloseTo(-l, 6);
    const spin = { ...initialDozer(2048), angVel: 1 };
    expect(trackSurfaceSpeed(spin, l)).toBeGreaterThan(0); // turning right: the left track drives forward
    expect(trackSurfaceSpeed(spin, r)).toBeLessThan(0);
    const fwd = run(60, { throttle: 1, steer: 0, brake: false });
    expect(trackSurfaceSpeed(fwd, l)).toBeCloseTo(fwd.speed, 6);
  });
});

describe('createKeyboard', () => {
  const key = (type: string, code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
    Object.assign(new Event(type, { cancelable: true }), {
      code,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...mods,
    });
  const setup = () => {
    const target = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    return { target, doc, kb: createKeyboard(target, doc) };
  };
  it('ignores keys typed into a page text field and can release held keys', () => {
    const { target, kb } = setup();
    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(kb.read().steer).toBe(1);
    kb.clear();
    expect(kb.read().steer).toBe(0);
    const e = Object.defineProperty(key('keydown', 'KeyW'), 'target', { value: { tagName: 'INPUT', type: 'email' } });
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(kb.read().throttle).toBe(0);
  });
  it('records held keys and prevents their default', () => {
    const { target, kb } = setup();
    const e = key('keydown', 'KeyW');
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(kb.read().throttle).toBe(1);
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(kb.read().throttle).toBe(0);
  });
  it('ignores Cmd/Ctrl/Alt chords so browser shortcuts work and keys do not stick', () => {
    const { target, kb } = setup();
    for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      const e = key('keydown', 'KeyD', { [mod]: true });
      target.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      expect(kb.read().steer).toBe(0);
    }
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(key('keydown', 'KeyS', { metaKey: true })); // Cmd chord: held keys may never see keyup
    expect(kb.read().throttle).toBe(0);
  });
  it('clears held keys when the page becomes hidden', () => {
    const { target, doc, kb } = setup();
    target.dispatchEvent(key('keydown', 'KeyW'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(kb.read().throttle).toBe(0);
  });
});

describe('initialDozer and walls off', () => {
  it('defaults to the bottom-centre without a spot', () => {
    const s = initialDozer(2048);
    expect(s.x).toBe(1024);
  });
  it('does not clamp to the page when walls are off', () => {
    const s = { ...initialDozer(2048), x: -300, y: 900, angle: 0, speed: 100 };
    const n = stepDozer(s, { throttle: 0, steer: 0, brake: false }, 1 / 60, 2048, false);
    expect(n.x).toBeLessThan(-290);
    expect(n.wallTurn).toBe(0);
    expect(stepDozer(s, { throttle: 0, steer: 0, brake: false }, 1 / 60, 2048).x).toBeGreaterThan(0);
  });
});

describe('blade region (scooped bodies ride while they overlap it)', () => {
  it('is two convex CCW quads covering the push quads and the cutting edge', async () => {
    const { bladeRegion } = await import('../src/dozer');
    const s = { ...initialDozer(2048), x: 700, y: 900, angle: 0.4 };
    const region = bladeRegion(s);
    expect(region).toHaveLength(2);
    for (const q of region) {
      expect(signedArea(q)).toBeGreaterThan(0);
      expect(isConvex(q)).toBe(true);
    }
    const inside = (q: V2[], [x, y]: V2) =>
      q.every((a, k) => {
        const b = q[(k + 1) % 4]!;
        return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-6;
      });
    const { blade, wing } = dozerPolygons(s);
    // The push line (front faces) lies in the region.
    for (const p of [blade[1]!, blade[2]!, wing[2]!]) expect(region.some((q) => inside(q, p))).toBe(true);
  });
});
