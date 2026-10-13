// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Page interaction while dozing: pure geometry for picking a body under the cursor and mapping the cursor back to the
// body's ORIGINAL page position (where the real DOM element still sits, under the opaque view canvas), plus small
// helpers for the control actions. No DOM or GPU access here.
//
// Picking order. The renderer draws every body with one indirect instanced draw per layer, in slot order, unscooped
// bodies first (under the blade), scooped bodies (FLAG_SCOOPED) last (over the blade). So the topmost body under a
// point is the scooped hit with the highest slot index, else the unscooped hit with the highest slot index. Pile
// height only scales a body as it is drawn (render.wgsl bodyCorner); it does not change the draw order, but the
// hit test uses the drawn (scaled) quad.
import { FLAG_ACTIVE, FLAG_SCOOPED, POSE_F32, PROPS_F32, SHAPE_F32 } from './bodies';

/** Camera of a rendered frame (main.ts lastView): world centre, world view size, viewport CSS px. */
export interface ViewState {
  camera: [number, number];
  size: [number, number];
  vp: [number, number];
}

/** View CSS px → world (page) px; the inverse of main.ts toScreen. */
export function screenToWorld(sx: number, sy: number, v: ViewState): [number, number] {
  return [v.camera[0] + (sx / v.vp[0] - 0.5) * v.size[0], v.camera[1] + (sy / v.vp[1] - 0.5) * v.size[1]];
}

/** World point → body-local frame (inverse of world = pos + rot(angle)·local, common.wgsl rot). */
export function worldToLocal(px: number, py: number, x: number, y: number, angle: number): [number, number] {
  const dx = px - x,
    dy = py - y,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return [c * dx + s * dy, -s * dx + c * dy];
}

/** Point inside a convex quad with positive winding (bodies.ts verts: cross(edge, p − v) ≥ 0 for every edge). */
export function inConvexQuad(v: ArrayLike<number>, x: number, y: number): boolean {
  for (let k = 0; k < 4; k++) {
    const ax = v[k * 2]!,
      ay = v[k * 2 + 1]!,
      bx = v[((k + 1) % 4) * 2]!,
      by = v[((k + 1) % 4) * 2 + 1]!;
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}

/**
 * UV at local point (x, y) of a body whose 4 verts `v` map to the UVs `uv` (8 floats each). Bodies start as rectangles
 * with an axis-aligned UV box and fracture cuts them along edges with linearly interpolated UVs, so local → UV is
 * affine for every fragment; it is solved from the largest-area triangle of the quad.
 */
export function localToUv(v: ArrayLike<number>, uv: ArrayLike<number>, x: number, y: number): [number, number] {
  let best: [number, number, number] = [0, 1, 2],
    bestArea = -1;
  for (const t of [
    [0, 1, 2],
    [0, 2, 3],
    [0, 1, 3],
    [1, 2, 3],
  ] as [number, number, number][]) {
    const [a, b, c] = t;
    const area = Math.abs(
      (v[b * 2]! - v[a * 2]!) * (v[c * 2 + 1]! - v[a * 2 + 1]!) -
        (v[b * 2 + 1]! - v[a * 2 + 1]!) * (v[c * 2]! - v[a * 2]!),
    );
    if (area > bestArea) {
      bestArea = area;
      best = t;
    }
  }
  const [a, b, c] = best;
  const ax = v[a * 2]!,
    ay = v[a * 2 + 1]!;
  const e1x = v[b * 2]! - ax,
    e1y = v[b * 2 + 1]! - ay,
    e2x = v[c * 2]! - ax,
    e2y = v[c * 2 + 1]! - ay;
  const det = e1x * e2y - e1y * e2x;
  if (Math.abs(det) < 1e-9) return [uv[a * 2]!, uv[a * 2 + 1]!];
  const px = x - ax,
    py = y - ay;
  const s = (px * e2y - py * e2x) / det,
    t = (e1x * py - e1y * px) / det;
  return [
    uv[a * 2]! + s * (uv[b * 2]! - uv[a * 2]!) + t * (uv[c * 2]! - uv[a * 2]!),
    uv[a * 2 + 1]! + s * (uv[b * 2 + 1]! - uv[a * 2 + 1]!) + t * (uv[c * 2 + 1]! - uv[a * 2 + 1]!),
  ];
}

/** CPU copy of the body buffers (bodies.ts layout) for slots < count. */
export interface BodySnapshot {
  count: number;
  /** POSE_F32 per slot: x, y, angle, pad. */
  pose: Float32Array;
  /** SHAPE_F32 per slot: 4 local verts then 4 UVs. */
  shape: Float32Array;
  /** PROPS_F32 per slot (radius at 2, flags as u32 at 3, height at 6). */
  props: Float32Array;
}

/** Render-side pile scale (sim.ts TUNING heightScale / heightRest; render.wgsl bodyCorner). */
export interface HeightScale {
  heightScale: number;
  heightRest: number;
}

export interface Pick {
  index: number;
  /** The cursor in the body's local (unscaled) frame. */
  local: [number, number];
  /** The cursor mapped to the body's original page position (page CSS px). */
  page: [number, number];
  scooped: boolean;
}

/** Drawn scale of a body at pile height h (render.wgsl: 1 + heightScale · clamp(h − heightRest, 0, 4)). */
export function drawScale(h: number, hs: HeightScale): number {
  return 1 + hs.heightScale * Math.min(4, Math.max(0, h - hs.heightRest));
}

/** Maps world point (wx, wy) through body `i` of `snap` (no hit test): local frame, then page px via its UVs. */
export function mapThroughBody(
  snap: BodySnapshot,
  i: number,
  wx: number,
  wy: number,
  pageSize: number,
  hs: HeightScale,
): { local: [number, number]; page: [number, number] } {
  const p = i * POSE_F32;
  const scale = drawScale(snap.props[i * PROPS_F32 + 6]!, hs);
  const [lx0, ly0] = worldToLocal(wx, wy, snap.pose[p]!, snap.pose[p + 1]!, snap.pose[p + 2]!);
  const lx = lx0 / scale,
    ly = ly0 / scale;
  const s = snap.shape.subarray(i * SHAPE_F32, i * SHAPE_F32 + SHAPE_F32);
  const [u, v] = localToUv(s.subarray(0, 8), s.subarray(8, 16), lx, ly);
  return { local: [lx, ly], page: [u * pageSize, v * pageSize] };
}

/** Topmost active body under world point (wx, wy) in draw order (see the header), or null on a miss. */
export function pickBody(snap: BodySnapshot, wx: number, wy: number, pageSize: number, hs: HeightScale): Pick | null {
  const flags = new Uint32Array(snap.props.buffer, snap.props.byteOffset, snap.props.length);
  let best = -1,
    bestScooped = false;
  const maxScale = 1 + hs.heightScale * 4;
  for (let i = 0; i < snap.count; i++) {
    const f = flags[i * PROPS_F32 + 3]!;
    if (!(f & FLAG_ACTIVE)) continue;
    const scooped = (f & FLAG_SCOOPED) !== 0;
    if (best >= 0 && bestScooped && !scooped) continue; // an unscooped body never draws over a scooped one
    const p = i * POSE_F32;
    const dx = wx - snap.pose[p]!,
      dy = wy - snap.pose[p + 1]!;
    const r = snap.props[i * PROPS_F32 + 2]! * maxScale;
    if (dx * dx + dy * dy > r * r) continue;
    const scale = drawScale(snap.props[i * PROPS_F32 + 6]!, hs);
    const [lx, ly] = worldToLocal(wx, wy, snap.pose[p]!, snap.pose[p + 1]!, snap.pose[p + 2]!);
    if (!inConvexQuad(snap.shape.subarray(i * SHAPE_F32, i * SHAPE_F32 + 8), lx / scale, ly / scale)) continue;
    best = i; // later slots draw on top within a layer
    bestScooped = scooped;
  }
  if (best < 0) return null;
  const m = mapThroughBody(snap, best, wx, wy, pageSize, hs);
  return { index: best, ...m, scooped: bestScooped };
}

/** Point in a convex polygon of either winding (the dozer chassis from dozerPolygons). */
export function inConvexPolygon(
  poly: readonly (readonly [number, number])[] | readonly number[][],
  x: number,
  y: number,
): boolean {
  let sign = 0;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!,
      b = poly[(k + 1) % poly.length]!;
    const c = (b[0]! - a[0]!) * (y - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/**
 * Range value for page x `px` over a slider occupying [left, left + width] (page px): the thumb centre runs from
 * left + thumb/2 to left + width − thumb/2 (Chromium's native slider). Snapped to `step` from `min`, clamped.
 */
export function rangeValueAt(
  px: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number,
  thumb = 16,
): number {
  const track = Math.max(1, width - thumb);
  const t = Math.min(1, Math.max(0, (px - left - thumb / 2) / track));
  let v = min + t * (max - min);
  if (step > 0) v = min + Math.round((v - min) / step) * step;
  return Math.min(max, Math.max(min, v));
}

/** Input types that take typed text (the keyboard goes to the page while one has focus). */
const TEXT_TYPES = new Set([
  'text',
  'search',
  'email',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'url',
  'tel',
  'password',
]);

/** Duck-typed element: tag name (any case), input type, contentEditable. */
interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** True for a text-entry element: a textarea, a text-like input or a contenteditable element. */
export function isTextEntry(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const e = el as ElementLike;
  const tag = typeof e.tagName === 'string' ? e.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TEXT_TYPES.has((e.type ?? 'text').toLowerCase());
  return e.isContentEditable === true;
}

/** What a click on a control does (pagecontrols.ts actOn). */
export type ControlKind = 'click' | 'range' | 'select' | 'text' | 'color' | 'none';

/** The action for an element (tag, input type): text entry, range drag, select cycle, colour cycle or a real click. */
export function controlKind(el: ElementLike): ControlKind {
  const tag = (el.tagName ?? '').toUpperCase();
  if (isTextEntry(el)) return 'text';
  if (tag === 'SELECT') return 'select';
  if (tag === 'INPUT') {
    const t = (el.type ?? 'text').toLowerCase();
    if (t === 'range') return 'range';
    if (t === 'color') return 'color';
    if (t === 'hidden' || t === 'file') return 'none';
    return 'click'; // checkbox, radio, button, submit, reset, image
  }
  return 'click'; // button, label, summary, [role=switch], [role=button], …
}

/** Next index when cycling a select of `n` options (wraps; a disabled option list just stays put). */
export function nextOption(selected: number, n: number): number {
  return n > 0 ? (Math.max(-1, selected) + 1) % n : -1;
}

/**
 * Where page point (px, py) is drawn now on body `i` (world px), or null when the point is outside the body's UV quad:
 * the inverse of mapThroughBody (the UV → local map is the same affine solve with the roles swapped).
 */
export function pageToWorld(
  snap: BodySnapshot,
  i: number,
  px: number,
  py: number,
  pageSize: number,
  hs: HeightScale,
): [number, number] | null {
  const s = snap.shape.subarray(i * SHAPE_F32, i * SHAPE_F32 + SHAPE_F32);
  const uv = s.subarray(8, 16),
    u = px / pageSize,
    v = py / pageSize;
  if (!inConvexQuad(uv, u, v)) return null;
  const [lx, ly] = localToUv(uv, s.subarray(0, 8), u, v);
  const p = i * POSE_F32,
    scale = drawScale(snap.props[i * PROPS_F32 + 6]!, hs);
  const a = snap.pose[p + 2]!,
    c = Math.cos(a),
    sn = Math.sin(a);
  return [snap.pose[p]! + (c * lx - sn * ly) * scale, snap.pose[p + 1]! + (sn * lx + c * ly) * scale];
}
