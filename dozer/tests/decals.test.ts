// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { createDecalStamper, decalAlpha, DECALS, type DecalStamp } from '../src/decals';
import { initialDozer, stepDozer, trackSurfaceSpeed, treadOffset, TRACK_ART, artToLocal } from '../src/dozer';

const drive = (input: { throttle: -1 | 0 | 1; steer: -1 | 0 | 1 }, steps: number) => {
  const st = createDecalStamper();
  const out: DecalStamp[] = [];
  let s = { ...initialDozer(2048), x: 1000, y: 1000 };
  const yl = treadOffset(TRACK_ART.leftTread),
    yr = treadOffset(TRACK_ART.rightTread);
  let travel = 0;
  for (let k = 0; k < steps; k++) {
    s = stepDozer(s, { ...input, brake: false }, 1 / 60, 2048);
    const dl = trackSurfaceSpeed(s, yl) / 60,
      dr = trackSurfaceSpeed(s, yr) / 60;
    travel += Math.abs(dl);
    st.step(s, dl, dr, (d) => out.push(d));
  }
  return { out, s, travel };
};

describe('track decals', () => {
  it('stamps one print per lug of travel on each track, at the rear end when driving forward', () => {
    const { out, s, travel } = drive({ throttle: 1, steer: 0 }, 120);
    const left = out.filter((d) => d.side === 0).length;
    expect(left).toBe(Math.floor(travel / DECALS.spacing));
    expect(out.filter((d) => d.side === 1).length).toBe(left);
    // Facing up (−y): the newest print sits behind the dozer centre (larger y), near the tread's rear end.
    const last = out[out.length - 1]!;
    const rear = artToLocal(TRACK_ART.leftTread.at)[0];
    expect(last.y - s.y).toBeGreaterThan(-rear - DECALS.spacing * 2);
  });
  it('stamps at the front end when reversing, and on both tracks when turning on the spot', () => {
    const back = drive({ throttle: -1, steer: 0 }, 120);
    const last = back.out[back.out.length - 1]!;
    expect(last.y).toBeLessThan(back.s.y); // ahead of the centre (facing up)
    const spin = drive({ throttle: 0, steer: 1 }, 240);
    expect(spin.out.some((d) => d.side === 0) && spin.out.some((d) => d.side === 1)).toBe(true);
  });
  it('fades linearly from alphaNew to 0 over the ring', () => {
    expect(decalAlpha(0)).toBeCloseTo(DECALS.alphaNew);
    expect(decalAlpha(DECALS.cap / 2)).toBeCloseTo(DECALS.alphaNew / 2);
    expect(decalAlpha(DECALS.cap)).toBe(0);
    expect(DECALS.cap).toBe(4000);
  });
});
