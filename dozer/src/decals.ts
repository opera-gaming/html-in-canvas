// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Track decals: faint tread prints left on the page. The CPU decides when and where to stamp (here, pure); the GPU
// keeps a fixed FIFO ring of DECALS.cap prints (render.ts) and fades each one by its age in stamps.
import { TRACK_ART, artToLocal, spriteScale, type ArtLayer, type DozerState } from './dozer';
import type { V2 } from './geom';

export const DECALS = {
  /** Ring capacity: the oldest print is overwritten (it has faded to 0 by then). */
  cap: 4000,
  /** Travel (world px) per print = one tread lug (25.6 of the tread texture's 256 px). */
  spacing: 25.6 * spriteScale,
  /** Opacity of the newest print; it falls linearly to 0 as the print nears being overwritten. */
  alphaNew: 0.25,
};

/** One print: world centre, heading, which track (0 left, 1 right). */
export interface DecalStamp {
  x: number;
  y: number;
  angle: number;
  side: 0 | 1;
}

/** Dozer-local x range and centreline y (world px) of a tread. */
function treadSpan(l: ArtLayer): { rear: number; front: number; y: number } {
  const [rear, y0] = artToLocal(l.at);
  const [front, y1] = artToLocal([l.at[0] + l.size[0], l.at[1] + l.size[1]]);
  return { rear, front, y: (y0 + y1) / 2 };
}

/**
 * Stamps a print each time a track's top run has travelled DECALS.spacing (either direction). Driving forward the
 * ground leaves the track at its rear end, so the print goes there; reversing, at the front end.
 */
export function createDecalStamper(): {
  /** Track travel deltas (world px, forward positive) for this step; calls `emit` for each print. */
  step(s: DozerState, dLeft: number, dRight: number, emit: (d: DecalStamp) => void): void;
  reset(): void;
} {
  const spans = [treadSpan(TRACK_ART.leftTread), treadSpan(TRACK_ART.rightTread)] as const;
  const acc = [0, 0];
  return {
    step(s, dLeft, dRight, emit) {
      const c = Math.cos(s.angle),
        sn = Math.sin(s.angle);
      [dLeft, dRight].forEach((d, side) => {
        if (!Number.isFinite(d)) return;
        acc[side]! += Math.abs(d);
        while (acc[side]! >= DECALS.spacing) {
          acc[side]! -= DECALS.spacing;
          const sp = spans[side as 0 | 1];
          const lx = d >= 0 ? sp.rear + DECALS.spacing / 2 : sp.front - DECALS.spacing / 2;
          const p: V2 = [s.x + c * lx - sn * sp.y, s.y + sn * lx + c * sp.y];
          emit({ x: p[0], y: p[1], angle: s.angle, side: side as 0 | 1 });
        }
      });
    },
    reset() {
      acc[0] = 0;
      acc[1] = 0;
    },
  };
}

/** Opacity of a print `age` stamps old (0 = newest) in a ring of `cap`: alphaNew falling linearly to 0. */
export function decalAlpha(age: number, cap = DECALS.cap): number {
  return age < 0 || age >= cap ? 0 : DECALS.alphaNew * (1 - age / cap);
}
