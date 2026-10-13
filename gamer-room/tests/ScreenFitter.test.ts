// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry, Vector3, MeshBasicMaterial } from 'three';
import { fitScreen, normalizeScreenUVs } from '../src/scene/ScreenFitter';

function quad(w: number, h: number) {
  return new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial());
}

/** A strip of `segments` quads along X, bowed toward -Z by `sag` at the middle, UVs 0..1. */
function curvedStrip(w: number, h: number, sag: number, segments = 8) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * w;
    const z = -sag * (1 - (2 * t - 1) ** 2);
    pos.push(x, -h / 2, z, x, h / 2, z);
    uv.push(t, 0, t, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return new Mesh(g, new MeshBasicMaterial());
}

describe('normalizeScreenUVs', () => {
  it('stretches a letterboxed v range to 0..1', () => {
    const g = new PlaneGeometry(1, 1);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.075 + uv.getY(i) * 0.85);
    const r = normalizeScreenUVs(g, false)!;
    expect(r.vMin).toBeCloseTo(0.075);
    expect(r.vMax).toBeCloseTo(0.925);
    const ys = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(1);
  });
  it('flips v when asked', () => {
    const g = new PlaneGeometry(1, 1); // PlaneGeometry: vertex 0 is top-left with v = 1
    normalizeScreenUVs(g, true);
    expect(g.getAttribute('uv').getY(0)).toBeCloseTo(0);
  });
  it('returns null without UVs', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    expect(normalizeScreenUVs(g, false)).toBeNull();
  });
});

describe('fitScreen', () => {
  it('fits an untransformed plane', () => {
    const m = quad(2, 1);
    m.updateMatrixWorld();
    const r = fitScreen(m)!;
    expect(r.width).toBeCloseTo(2);
    expect(r.height).toBeCloseTo(1);
    expect(r.center.length()).toBeCloseTo(0);
    expect(r.right.x).toBeCloseTo(1);
    expect(r.up.y).toBeCloseTo(1);
    expect(r.normal.z).toBeCloseTo(1);
    expect(r.curved).toBe(false);
  });

  it('follows the world transform', () => {
    const m = quad(2, 1);
    m.position.set(3, 1, -2);
    m.rotation.y = Math.PI / 2;
    m.scale.set(2, 2, 2);
    m.updateMatrixWorld();
    const r = fitScreen(m)!;
    expect(r.width).toBeCloseTo(4);
    expect(r.height).toBeCloseTo(2);
    expect(r.center.x).toBeCloseTo(3);
    expect(r.normal.x).toBeCloseTo(1);
    expect(Math.abs(r.normal.z)).toBeLessThan(1e-6);
  });

  it('flips the normal toward the facing point and keeps a right-handed frame', () => {
    const m = quad(2, 1);
    m.updateMatrixWorld();
    const r = fitScreen(m, new Vector3(0, 0, -5))!;
    expect(r.normal.z).toBeCloseTo(-1);
    expect(r.right.clone().cross(r.up).dot(r.normal)).toBeGreaterThan(0.99);
  });

  it('fits a curved strip to its chord and flags it curved', () => {
    const m = curvedStrip(0.83, 0.35, 0.08);
    m.updateMatrixWorld();
    const r = fitScreen(m)!;
    expect(r.curved).toBe(true);
    expect(r.width).toBeCloseTo(0.83);
    expect(r.height).toBeCloseTo(0.35);
    expect(r.center.z).toBeCloseTo(0); // chord plane, not the sagging middle
    expect(r.normal.z).toBeCloseTo(1);
  });

  it('does not flag a flat plane with tiny numeric noise as curved', () => {
    const m = quad(1, 1);
    m.updateMatrixWorld();
    expect(fitScreen(m)!.curved).toBe(false);
  });
});
