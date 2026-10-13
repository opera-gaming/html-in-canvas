// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// 2D geometry for slicing: convex polygons with texture coordinates, split by a line.

export interface Vec {
  x: number;
  y: number;
}
/** A convex polygon's vertex: position (local CSS px) and texture coordinate. */
export interface Vert {
  x: number;
  y: number;
  u: number;
  v: number;
}

export const rotate = (p: Vec, a: number): Vec => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
};

/** An axis-aligned w × h rectangle centred on the origin, textured 0..1 (v down). */
export function rectPoly(w: number, h: number): Vert[] {
  return [
    { x: -w / 2, y: -h / 2, u: 0, v: 0 },
    { x: w / 2, y: -h / 2, u: 1, v: 0 },
    { x: w / 2, y: h / 2, u: 1, v: 1 },
    { x: -w / 2, y: h / 2, u: 0, v: 1 },
  ];
}

/**
 * Splits a convex polygon by the line through `p` along `d`. Returns the two sides (left of d first), or null when
 * the line misses the polygon or only grazes it (either side under `minArea`).
 */
export function splitPoly(poly: Vert[], p: Vec, d: Vec, minArea = 40): [Vert[], Vert[]] | null {
  const side = (q: Vert): number => d.x * (q.y - p.y) - d.y * (q.x - p.x);
  const a: Vert[] = [],
    b: Vert[] = [];
  for (let i = 0; i < poly.length; i++) {
    const v0 = poly[i]!,
      v1 = poly[(i + 1) % poly.length]!;
    const s0 = side(v0),
      s1 = side(v1);
    if (s0 >= 0) a.push(v0);
    if (s0 <= 0) b.push(v0);
    if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) {
      const t = s0 / (s0 - s1);
      const m = {
        x: v0.x + (v1.x - v0.x) * t,
        y: v0.y + (v1.y - v0.y) * t,
        u: v0.u + (v1.u - v0.u) * t,
        v: v0.v + (v1.v - v0.v) * t,
      };
      a.push(m);
      b.push(m);
    }
  }
  if (a.length < 3 || b.length < 3 || area(a) < minArea || area(b) < minArea) return null;
  return [a, b];
}

function area(poly: Vec[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!,
      q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function centroid(poly: Vec[]): Vec {
  let cx = 0,
    cy = 0,
    s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!,
      q = poly[(i + 1) % poly.length]!;
    const k = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * k;
    cy += (p.y + q.y) * k;
    s += k;
  }
  if (Math.abs(s) < 1e-9) return { x: 0, y: 0 };
  return { x: cx / (3 * s), y: cy / (3 * s) };
}

/** Whether segment a→b crosses any edge of `poly` (or lies inside it). */
export function segmentHitsPoly(a: Vec, b: Vec, poly: Vec[]): boolean {
  if (pointInConvex(a, poly) || pointInConvex(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (segmentsCross(a, b, poly[i]!, poly[(i + 1) % poly.length]!)) return true;
  }
  return false;
}

function pointInConvex(q: Vec, poly: Vec[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!,
      r = poly[(i + 1) % poly.length]!;
    const c = (r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x);
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
  }
  return true;
}

function segmentsCross(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const d = (a: Vec, b: Vec, c: Vec): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1),
    d2 = d(p3, p4, p2),
    d3 = d(p1, p2, p3),
    d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
