// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Pure polygon geometry: the CPU reference for the GPU physics/fracture shaders.
// Keep the arithmetic simple and branch-light so it ports to WGSL line-for-line.

export type V2 = [number, number];

/** A convex quad with per-vertex UVs; vertex order always has signedArea(v) > 0 (the packer's canonical winding). */
export interface Quad {
  v: [V2, V2, V2, V2];
  uv: [V2, V2, V2, V2];
}

const at = (v: readonly V2[], i: number): V2 => v[i % v.length]!;
const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Shoelace area: sum(x_i*y_{i+1} - x_{i+1}*y_i) / 2. */
export function signedArea(v: readonly V2[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = at(v, i),
      b = at(v, i + 1);
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function centroid(v: readonly V2[]): V2 {
  let cx = 0,
    cy = 0,
    s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = at(v, i),
      b = at(v, i + 1);
    const c = a[0] * b[1] - b[0] * a[1];
    s += c;
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
  }
  const k = 1 / (3 * s); // = 1 / (6 * area)
  return [cx * k + 0, cy * k + 0]; // + 0 normalises -0
}

/** Polar second moment of the polygon about `about`, divided by its area (i.e. per unit mass). */
export function inertiaPerMass(v: readonly V2[], about: V2): number {
  let num = 0,
    s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = at(v, i),
      b = at(v, i + 1);
    const ax = a[0] - about[0],
      ay = a[1] - about[1];
    const bx = b[0] - about[0],
      by = b[1] - about[1];
    const c = ax * by - bx * ay;
    s += c;
    num += c * (ax * ax + ax * bx + bx * bx + ay * ay + ay * by + by * by);
  }
  // I = num / 12, area = s / 2  →  I / area = num / (6 s)
  return num / (6 * s);
}

/** True when every edge-pair cross product has the same sign (zeros allowed). */
export function isConvex(v: readonly V2[]): boolean {
  let pos = false,
    neg = false;
  for (let i = 0; i < v.length; i++) {
    const a = at(v, i),
      b = at(v, i + 1),
      c = at(v, i + 2);
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr > 0) pos = true;
    else if (cr < 0) neg = true;
  }
  return !(pos && neg);
}

/** Edge i = v[i] -> v[(i+1)%4]. */
export function edgeLengths(q: Quad): [number, number, number, number] {
  const len = (i: number) => {
    const a = at(q.v, i),
      b = at(q.v, i + 1);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  return [len(0), len(1), len(2), len(3)];
}

/**
 * Cut from P on edge `edge` (param tA) to Q' on edge `edge+2` (param tB).
 * Half A = [P, v[e+1], v[e+2], Q'], Half B = [Q', v[e+3], v[e], P], Q' = lerp(v[e+2], v[e+3], tB).
 * UVs are interpolated identically; both halves keep the input winding.
 */
export function cutQuad(q: Quad, edge: 0 | 1, tA: number, tB: number): [Quad, Quad] {
  const e = edge;
  const v = (i: number) => at(q.v, e + i),
    uv = (i: number) => at(q.uv, e + i);
  const p = lerp2(v(0), v(1), tA),
    pu = lerp2(uv(0), uv(1), tA);
  const r = lerp2(v(2), v(3), tB),
    ru = lerp2(uv(2), uv(3), tB);
  return [
    { v: [p, v(1), v(2), r], uv: [pu, uv(1), uv(2), ru] },
    { v: [r, v(3), v(0), p], uv: [ru, uv(3), uv(0), pu] },
  ];
}

export const BREAK_MIN_LONG_SIDE = 28,
  FRAG_MIN_ALONG = 10,
  FRAG_MIN_AREA = 80,
  LONG_WORD_ASPECT = 3;
/** Objects whose opposite-edge pair sums differ by less than this factor may be cut along either pair (chooseCut). */
export const SQUARE_RATIO = 1.3;

/**
 * Pick a fracture cut. The cut joins the longer opposite-edge pair (so it runs across the long axis); objects that are
 * nearly square (pair sums within SQUARE_RATIO) take the other pair when jitterEdge > 0, so repeated breaks give
 * roughly square shards. t = 0.5 + jitter * 0.3.
 * Returns null if the longest side < BREAK_MIN_LONG_SIDE, any of the four sub-lengths along the cut edges
 * < FRAG_MIN_ALONG, or either half's area < FRAG_MIN_AREA. Mirrored by chooseCut in fracture.wgsl.
 */
export function chooseCut(
  q: Quad,
  word: boolean,
  jitterA: number,
  jitterB: number,
  jitterEdge = 0,
): { edge: 0 | 1; tA: number; tB: number } | null {
  const [l0, l1, l2, l3] = edgeLengths(q);
  if (Math.max(l0, l1, l2, l3) < BREAK_MIN_LONG_SIDE) return null;
  const sum0 = l0 + l2,
    sum1 = l1 + l3;
  let edge: 0 | 1 = sum0 >= sum1 ? 0 : 1;
  if (!word && jitterEdge > 0 && Math.max(sum0, sum1) < SQUARE_RATIO * Math.min(sum0, sum1)) edge = edge === 0 ? 1 : 0;
  const la = edge === 0 ? l0 : l1,
    lb = edge === 0 ? l2 : l3;
  const tA = 0.5 + jitterA * 0.3,
    tB = 0.5 + jitterB * 0.3;
  const minAlong = Math.min(tA * la, (1 - tA) * la, tB * lb, (1 - tB) * lb);
  if (minAlong < FRAG_MIN_ALONG) return null;
  const [a, b] = cutQuad(q, edge, tA, tB);
  if (Math.abs(signedArea(a.v)) < FRAG_MIN_AREA || Math.abs(signedArea(b.v)) < FRAG_MIN_AREA) return null;
  return { edge, tA, tB };
}

export interface SatContact {
  depth: number;
  normal: V2;
  point: V2;
}

/** Vertices within this distance outside an edge still count as inside (contact-point gathering). */
const SAT_INSIDE_EPS = 1e-4;

/** Min/max of dot(v, n) over the quad. */
function project(v: readonly V2[], nx: number, ny: number): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < 4; i++) {
    const d = v[i]![0] * nx + v[i]![1] * ny;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/** p is inside (or on) quad q, which has signedArea > 0: cross(edge, p - v_i) >= 0 for every edge. */
function insideQuad(q: readonly V2[], p: V2): boolean {
  let ok = true;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!,
      b = q[(i + 1) % 4]!;
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    ok = ok && cr >= -SAT_INSIDE_EPS;
  }
  return ok;
}

/**
 * Separating-axis test for two convex quads (signedArea > 0). Returns null when separated or merely
 * touching. `normal` (unit) points from b to a: moving a by normal*depth separates them (the direction is
 * taken from the projection intervals, not the centres, so it stays right for deep overlaps). `point` is the
 * average of a's vertices inside b and b's vertices inside a, or the midpoint of the two vertex centres if
 * none are inside. Mirrored line-for-line by `sat()` in common.wgsl.
 */
export function satQuads(a: V2[], b: V2[]): SatContact | null {
  let depth = Infinity,
    nx = 0,
    ny = 0;
  for (let k = 0; k < 8; k++) {
    const q = k < 4 ? a : b,
      i = k % 4;
    const p0 = q[i]!,
      p1 = q[(i + 1) % 4]!;
    const ex = p1[0] - p0[0],
      ey = p1[1] - p0[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const ax = ey / len,
      ay = -ex / len;
    const [aLo, aHi] = project(a, ax, ay);
    const [bLo, bHi] = project(b, ax, ay);
    // Moving a by +axis*dPos or -axis*dNeg separates the pair; the smaller one is this axis' overlap.
    const dPos = bHi - aLo,
      dNeg = aHi - bLo;
    const overlap = Math.min(dPos, dNeg);
    if (overlap <= 0) return null;
    const sgn = dPos <= dNeg ? 1 : -1;
    if (overlap < depth) {
      depth = overlap;
      nx = ax * sgn;
      ny = ay * sgn;
    }
  }
  let caX = 0,
    caY = 0,
    cbX = 0,
    cbY = 0;
  for (let i = 0; i < 4; i++) {
    caX += a[i]![0] / 4;
    caY += a[i]![1] / 4;
    cbX += b[i]![0] / 4;
    cbY += b[i]![1] / 4;
  }
  let sx = 0,
    sy = 0,
    n = 0;
  for (let i = 0; i < 4; i++) {
    if (insideQuad(b, a[i]!)) {
      sx += a[i]![0];
      sy += a[i]![1];
      n++;
    }
    if (insideQuad(a, b[i]!)) {
      sx += b[i]![0];
      sy += b[i]![1];
      n++;
    }
  }
  const point: V2 = n > 0 ? [sx / n, sy / n] : [(caX + cbX) / 2, (caY + cbY) / 2];
  return { depth, normal: [nx + 0, ny + 0], point };
}
