// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  controlKind,
  inConvexPolygon,
  isTextEntry,
  localToUv,
  mapThroughBody,
  nextOption,
  pageToWorld,
  pickBody,
  rangeValueAt,
  screenToWorld,
  worldToLocal,
  type BodySnapshot,
} from '../src/interact';
import { FLAG_SCOOPED, packBodies, POSE_F32, PROPS_F32, SHAPE_F32 } from '../src/bodies';
import type { BodyInit } from '../src/extract';

const PAGE = 1000;
const HS = { heightScale: 0.06, heightRest: 1.1 };

/** A body at page rect (x, y, w, h) with its UV box. */
const body = (x: number, y: number, w: number, h: number): BodyInit => ({
  cx: x + w / 2,
  cy: y + h / 2,
  w,
  h,
  u0: x / PAGE,
  v0: y / PAGE,
  u1: (x + w) / PAGE,
  v1: (y + h) / PAGE,
  word: false,
});
const snapOf = (bodies: BodyInit[]): BodySnapshot => {
  const p = packBodies(bodies, bodies.length);
  return { count: p.count, pose: p.pose, shape: p.shape, props: p.props };
};
const move = (s: BodySnapshot, i: number, x: number, y: number, angle: number): void => {
  s.pose.set([x, y, angle], i * POSE_F32);
};

describe('screenToWorld', () => {
  it('inverts main.ts toScreen', () => {
    const v = {
      camera: [500, 400] as [number, number],
      size: [900, 600] as [number, number],
      vp: [1200, 800] as [number, number],
    };
    const [wx, wy] = screenToWorld(300, 100, v);
    const sx = ((wx - v.camera[0]) / v.size[0] + 0.5) * v.vp[0],
      sy = ((wy - v.camera[1]) / v.size[1] + 0.5) * v.vp[1];
    expect(sx).toBeCloseTo(300);
    expect(sy).toBeCloseTo(100);
  });
});

describe('worldToLocal', () => {
  it('undoes a rotation (common.wgsl rot: world = pos + R(angle)·local)', () => {
    const a = 0.7,
      lx = 12,
      ly = -5;
    const wx = 100 + Math.cos(a) * lx - Math.sin(a) * ly,
      wy = 50 + Math.sin(a) * lx + Math.cos(a) * ly;
    const [x, y] = worldToLocal(wx, wy, 100, 50, a);
    expect(x).toBeCloseTo(lx);
    expect(y).toBeCloseTo(ly);
  });
});

describe('pickBody', () => {
  it('maps a point on a moved, rotated body back to its original page position', () => {
    const s = snapOf([body(100, 200, 80, 20)]); // centre (140, 210)
    move(s, 0, 600, 700, Math.PI / 2);
    // A point 30 px right of the centre and 5 px down in the body's frame: rotated 90°, (30, 5) → (−5, 30).
    const pick = pickBody(s, 600 - 5, 700 + 30, PAGE, HS);
    expect(pick?.index).toBe(0);
    expect(pick!.page[0]).toBeCloseTo(170);
    expect(pick!.page[1]).toBeCloseTo(215);
  });

  it('maps through a fragment sub-rect (right half of a body, re-centred)', () => {
    const s = snapOf([body(100, 200, 80, 20)]);
    // Right half: local verts of a 40 × 20 piece centred at its own centre, UVs u ∈ [0.14, 0.18].
    s.shape.set([-20, -10, 20, -10, 20, 10, -20, 10, 0.14, 0.2, 0.18, 0.2, 0.18, 0.22, 0.14, 0.22], 0);
    move(s, 0, 300, 300, 0);
    const pick = pickBody(s, 300 + 10, 300 - 5, PAGE, HS);
    expect(pick!.page[0]).toBeCloseTo(170); // 160 (piece centre on the page) + 10
    expect(pick!.page[1]).toBeCloseTo(205);
  });

  it('maps through a non-rectangular fracture piece (affine UVs)', () => {
    const verts = [-10, -10, 10, -10, 14, 10, -6, 10];
    const uv = verts.map((c, k) => (k % 2 ? (c + 50) / PAGE : (c + 40) / PAGE)); // page = local + (40, 50)
    const [u, v] = localToUv(verts, uv, 3, 4);
    expect(u * PAGE).toBeCloseTo(43);
    expect(v * PAGE).toBeCloseTo(54);
  });

  it('misses outside every body and ignores inactive slots', () => {
    const s = snapOf([body(100, 200, 80, 20)]);
    expect(pickBody(s, 140, 240, PAGE, HS)).toBeNull(); // 30 px below the centre
    new Uint32Array(s.props.buffer)[3] = 0;
    expect(pickBody(s, 140, 210, PAGE, HS)).toBeNull();
  });

  it('picks the topmost body: scooped over unscooped, else the later slot', () => {
    const s = snapOf([body(0, 0, 100, 100), body(200, 0, 50, 50), body(400, 0, 20, 20)]);
    for (let i = 0; i < 3; i++) move(s, i, 500, 500, 0);
    expect(pickBody(s, 500, 500, PAGE, HS)?.index).toBe(2);
    new Uint32Array(s.props.buffer)[0 * PROPS_F32 + 3]! |= FLAG_SCOOPED;
    expect(pickBody(s, 500, 500, PAGE, HS)?.index).toBe(0);
  });

  it('hit tests the drawn (height-scaled) quad', () => {
    const s = snapOf([body(0, 0, 100, 20)]);
    move(s, 0, 500, 500, 0);
    expect(pickBody(s, 500 + 53, 500, PAGE, HS)).toBeNull();
    s.props[6] = 1.1 + 2; // drawn 12 % larger
    const pick = pickBody(s, 500 + 53, 500, PAGE, HS);
    expect(pick?.index).toBe(0);
    expect(pick!.page[0]).toBeCloseTo(50 + 53 / 1.12);
    expect(mapThroughBody(s, 0, 500, 500, PAGE, HS).page[0]).toBeCloseTo(50);
  });
  it('pageToWorld inverts mapThroughBody', () => {
    const s = snapOf([body(100, 200, 80, 20)]);
    move(s, 0, 600, 700, 1.1);
    const w = pageToWorld(s, 0, 170, 215, PAGE, HS)!;
    const m = mapThroughBody(s, 0, w[0], w[1], PAGE, HS);
    expect(m.page[0]).toBeCloseTo(170);
    expect(m.page[1]).toBeCloseTo(215);
    expect(pageToWorld(s, 0, 50, 50, PAGE, HS)).toBeNull();
  });
  it('SHAPE_F32 layout holds verts then UVs', () => expect(SHAPE_F32).toBe(16));
});

describe('helpers', () => {
  it('rangeValueAt projects along the track, snaps and clamps', () => {
    expect(rangeValueAt(8, 0, 116, 0, 100, 1)).toBe(0);
    expect(rangeValueAt(58, 0, 116, 0, 100, 1)).toBe(50);
    expect(rangeValueAt(500, 0, 116, 0, 100, 1)).toBe(100);
    expect(rangeValueAt(-5, 0, 116, 0, 100, 10)).toBe(0);
  });
  it('isTextEntry / controlKind classify controls', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'email' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'date' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry(new EventTarget())).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(controlKind({ tagName: 'INPUT', type: 'range' })).toBe('range');
    expect(controlKind({ tagName: 'SELECT' })).toBe('select');
    expect(controlKind({ tagName: 'INPUT', type: 'color' })).toBe('color');
    expect(controlKind({ tagName: 'LABEL' })).toBe('click');
    expect(controlKind({ tagName: 'INPUT', type: 'number' })).toBe('text');
  });
  it('nextOption wraps', () => {
    expect(nextOption(0, 3)).toBe(1);
    expect(nextOption(2, 3)).toBe(0);
    expect(nextOption(-1, 3)).toBe(0);
  });
  it('inConvexPolygon works for either winding', () => {
    const sq: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(inConvexPolygon(sq, 5, 5)).toBe(true);
    expect(inConvexPolygon([...sq].reverse(), 5, 5)).toBe(true);
    expect(inConvexPolygon(sq, 15, 5)).toBe(false);
  });
});
