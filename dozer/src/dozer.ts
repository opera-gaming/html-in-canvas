// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Kinematic bulldozer: pure stepping, footprint polygons and keyboard input.
import { isTextEntry } from './interact';
import type { V2 } from './geom';

/** `wallTurn` = the eased turn rate (rad/s) a grazing wall is currently adding (included in angVel). */
export interface DozerState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  angVel: number;
  vx: number;
  vy: number;
  wallTurn: number;
}
export interface DozerInput {
  throttle: -1 | 0 | 1;
  steer: -1 | 0 | 1;
  brake: boolean;
}

/** Driving dynamics (world px, s). The footprint comes from the art: see DOZER_ART below. */
export const DOZER = {
  maxSpeed: 260,
  accel: 420,
  brakeDecel: 900,
  drag: 1.5,
  turnRate: 1.9,
};

// Art and geometry (single source of truth).
// Every shape below is written in dozer.png pixel coordinates (512 × 279, facing +x: blade on the right, image top =
// the driver's left) and mapped to dozer-local world px by artToLocal(): local = (img − DOZER_ORIGIN) × spriteScale.
// Dozer-local frame: x forward, +y = the driver's right (world y points down), so image axes map onto local axes
// without a flip. The physics quads (chassis, blade, wing), the sprite and track quads (render.ts) and the
// cut line between the under-text blade layer and the above-text body layer all derive from these numbers.

/** World px per dozer.png pixel: the 512 × 279 art becomes a 230 × 126 world px dozer. */
export const spriteScale = 0.45;

/** Image-pixel size of public/dozer/dozer.png. */
export const DOZER_IMAGE: V2 = [512, 279];

/** Dozer origin (the point stepDozer moves and turns about): the centre of the body (x 3..385, y 68..213). */
export const DOZER_ORIGIN: V2 = [194, 140.5];

/** A sprite layer: image file (under public/dozer/), its pixel size and its top-left corner in dozer.png pixels. */
export interface ArtLayer {
  file: string;
  size: V2;
  at: V2;
}

/**
 * Track art. Each track background is centred on a body edge (body y 68..213), so half of each track sticks out
 * from under the body. The treads tile horizontally and scroll (render.ts); the backgrounds (hubs and the inner bar)
 * are drawn over them, then the body.
 */
export const TRACK_ART = {
  leftTread: { file: 'left-track.png', size: [256, 44], at: [60, 45] } as ArtLayer,
  rightTread: { file: 'right-track.png', size: [256, 44], at: [60, 192] } as ArtLayer,
  leftBackground: { file: 'left-track-background.png', size: [256, 68], at: [60, 34] } as ArtLayer,
  rightBackground: { file: 'right-track-background.png', size: [256, 67], at: [60, 180] } as ArtLayer,
};

/** Body + blade art (no tracks). */
export const BODY_ART: ArtLayer = { file: 'dozer.png', size: DOZER_IMAGE, at: [0, 0] };

/**
 * Blade geometry measured from dozer.png (image px). Polylines run from the blade's left end (image top) to its
 * right end. The right end leads (it reaches furthest forward), so material slides along the blade and spills off the
 * trailing left end.
 *  - cuttingEdge: the steel edge (main run, then the end wing bent back at the right end).
 *  - pushLine: where bodies are pushed: the bright yellow ridge along the moldboard behind the steel strip. Bodies
 *    between it and the cutting edge ride on the blade (the scoop zone) and are not pushed.
 *  - cut: the line between the blade layer (drawn under the text) and the body layer (drawn over it): the ridge's
 *    main run extended across the image, so pushed words never slide under the body layer; the arms and their
 *    pivots lie on the body side.
 */
export const BLADE_ART = {
  cuttingEdge: [
    [430, 2],
    [510, 180],
    [492, 275],
  ] as V2[],
  pushLine: [
    [399, 24],
    [450, 190],
    [471, 266],
  ] as V2[],
  cut: [
    [391, 0],
    [478, 279],
  ] as V2[],
  /**
   * The blade's sprite region as two convex quads (back-left, front-left, front-right, back-right): from the cut line to
   * the cutting edge for the main run, and for the lower run from the ridge's bend to the bottom (its back corner at
   * 466 rather than the cut line's 478, so the lower ridge's end, which lies just behind the cut line, is inside). A
   * scooped body keeps riding the blade while it overlaps this region.
   */
  region: [
    [
      [391, 0],
      [430, 2],
      [510, 180],
      [450, 190],
    ],
    [
      [450, 190],
      [510, 180],
      [492, 275],
      [466, 279],
    ],
  ] as V2[][],
  /** Thickness (image px) of the blade and wing collision quads, behind the push line. */
  pushDepth: 14,
};

/** Exhaust stack opening in dozer.png (image px): where the smoke comes out (smoke.ts). */
export const EXHAUST_ART: V2 = [261, 155];

/**
 * Chassis outline (image px): the body plus both tracks, its front on the blade and wing. Not a collision shape (the
 * dozer runs over words; only the blade pushes): it bounds the dozer for wall clamping.
 */
export const CHASSIS_ART = { rear: 3, top: 34, bottom: 247 };
/** How far (image px) the chassis outline's front corners reach into the blade and wing quads. */
const MOUNT_OVERLAP = 2;

/** dozer.png pixel → dozer-local world px. */
export const artToLocal = ([x, y]: V2): V2 => [
  (x - DOZER_ORIGIN[0]) * spriteScale,
  (y - DOZER_ORIGIN[1]) * spriteScale,
];

/** Dozer-local rect (minX, maxX, minY, maxY) an art layer maps onto. */
export function layerQuad(l: ArtLayer): { minX: number; maxX: number; minY: number; maxY: number } {
  const [minX, minY] = artToLocal(l.at);
  const [maxX, maxY] = artToLocal([l.at[0] + l.size[0], l.at[1] + l.size[1]]);
  return { minX, maxX, minY, maxY };
}

/** Lateral offset (dozer-local y, world px) of a tread's centreline: negative for the left track. */
export function treadOffset(l: ArtLayer): number {
  return artToLocal([0, l.at[1] + l.size[1] / 2])[1];
}

const MAX_DT = 1 / 30;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Facing up (angle 0 = +x, world y points down), at `spot` or, without one, at the bottom-centre of the page. */
export function initialDozer(pageSize: number, spot?: { x: number; y: number }): DozerState {
  const { x, y } = spot ?? { x: pageSize / 2, y: pageSize + dozerExtents().minX - 40 };
  return { x, y, angle: -Math.PI / 2, speed: 0, angVel: 0, vx: 0, vy: 0, wallTurn: 0 };
}

/** A wall hit within this angle (rad) of head-on stops the dozer; anything shallower slides it along the wall. */
export const WALL_HEADON = (25 * Math.PI) / 180;
/** Maximum turn rate (rad/s) a grazing wall adds, at full speed. */
export const WALL_ALIGN_RATE = 1.6;
/** Turn rate per radian of remaining misalignment (1/s): the turn eases out as the dozer lines up with the wall. */
export const WALL_ALIGN_GAIN = 3;
/** How quickly (1/s) the wall turn rate follows its target, so it eases in and out instead of switching. */
export const WALL_TURN_SMOOTH = 6;
/** The footprint counts as touching a wall within this distance (px), so contact doesn't flicker step to step. */
export const WALL_MARGIN = 6;

/**
 * Advances the dozer by `dt` seconds (clamped to 1/30). Pure: returns a new state. `walls` = false skips the page
 * walls (no clamping, no wall slide): the intro drives in from off-page with it until the footprint is inside.
 */
export function stepDozer(s: DozerState, input: DozerInput, dt: number, pageSize: number, walls = true): DozerState {
  const h = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_DT);
  const { maxSpeed, accel, brakeDecel, drag, turnRate } = DOZER;

  let speed = s.speed;
  if (input.brake) {
    const dv = brakeDecel * h;
    speed = Math.abs(speed) <= dv ? 0 : speed - Math.sign(speed) * dv;
  } else if (input.throttle !== 0) {
    speed += input.throttle * accel * h;
  } else {
    speed *= Math.exp(-drag * h);
  }
  speed = clamp(speed, -maxSpeed, maxSpeed);

  // Tank steering: turns even when stopped, faster when moving; reversing flips the direction.
  const dir = speed < 0 ? -1 : 1;
  const steerVel = input.steer * turnRate * (0.35 + (0.65 * Math.abs(speed)) / maxSpeed) * dir;
  // Grazing a wall eases the direction of travel onto it (see wallTurnTarget); the rate is smoothed both ways.
  const target = walls ? wallTurnTarget(s, speed, pageSize) : 0;
  const wallTurn = s.wallTurn + (target - s.wallTurn) * (1 - Math.exp(-WALL_TURN_SMOOTH * h));
  const angVel = steerVel + wallTurn;
  const angle = s.angle + angVel * h;

  const fx = Math.cos(angle),
    fy = Math.sin(angle);
  // Walls clamp the whole rotated footprint (chassis, blade, wing and the steel cutting edge), not a bounding circle,
  // so neither the collision quads nor the drawn blade poke through a wall.
  const tx = s.x + fx * speed * h,
    ty = s.y + fy * speed * h;
  const e = footprintExtents(angle);
  const x = walls ? clampAxis(tx, e.minX, e.maxX, pageSize) : tx;
  const y = walls ? clampAxis(ty, e.minY, e.maxY, pageSize) : ty;
  const vx = h > 0 ? (x - s.x) / h : 0;
  const vy = h > 0 ? (y - s.y) / h : 0;
  // A head-on wall or a corner kills the blocked component of the speed; a glancing wall keeps it (the dozer slides).
  if ((x !== tx || y !== ty) && !(target !== 0 || wallTurn !== 0)) speed = vx * fx + vy * fy;

  return { x, y, angle, speed, angVel, vx, vy, wallTurn };
}

/**
 * Turn rate (rad/s) a wall wants to add: when the footprint is within WALL_MARGIN of exactly one wall, moving into it
 * at a glancing angle (shallower than WALL_HEADON), steer the direction of travel toward the wall's tangent, in
 * proportion to the remaining angle and to speed. Head-on hits, corners and open ground give 0.
 */
function wallTurnTarget(s: DozerState, speed: number, pageSize: number): number {
  if (speed === 0) return 0;
  const e = footprintExtents(s.angle);
  const sgn = Math.sign(speed);
  const dx = Math.cos(s.angle) * sgn,
    dy = Math.sin(s.angle) * sgn;
  const walls: V2[] = [];
  if (s.x + e.minX <= WALL_MARGIN && dx < 0) walls.push([-1, 0]);
  if (pageSize - (s.x + e.maxX) <= WALL_MARGIN && dx > 0) walls.push([1, 0]);
  if (s.y + e.minY <= WALL_MARGIN && dy < 0) walls.push([0, -1]);
  if (pageSize - (s.y + e.maxY) <= WALL_MARGIN && dy > 0) walls.push([0, 1]);
  if (walls.length !== 1) return 0;
  const [nx, ny] = walls[0]!;
  const into = dx * nx + dy * ny;
  if (into >= Math.cos(WALL_HEADON)) return 0;
  const want = Math.atan2(dy - into * ny, dx - into * nx) + (sgn < 0 ? Math.PI : 0);
  const diff = Math.atan2(Math.sin(want - s.angle), Math.cos(want - s.angle));
  const cap = WALL_ALIGN_RATE * Math.min(1, Math.abs(speed) / DOZER.maxSpeed);
  return clamp(diff * WALL_ALIGN_GAIN, -cap, cap);
}

/** Clamp a centre coordinate so [v + min, v + max] stays in [0, pageSize] (centred if it can't fit). */
function clampAxis(v: number, min: number, max: number, pageSize: number): number {
  const lo = -min,
    hi = pageSize - max;
  return lo > hi ? (lo + hi) / 2 : clamp(v, lo, hi);
}

/** Dozer-local points that must stay inside the page: every collision quad corner plus the cutting edge. */
let footprintCache: readonly V2[] | null = null;
function footprintPoints(): readonly V2[] {
  if (!footprintCache) {
    const { chassis, blade, wing } = dozerLocalPolygons();
    footprintCache = Object.freeze([...chassis, ...blade, ...wing, ...BLADE_ART.cuttingEdge.map(artToLocal)]);
  }
  return footprintCache;
}

function extentsOf(pts: readonly V2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return footprintExtents(0, pts);
}

/** Axis-aligned extents of the footprint (or `pts`) rotated by `angle`, relative to the dozer centre. */
function footprintExtents(
  angle: number,
  pts: readonly V2[] = footprintPoints(),
): { minX: number; maxX: number; minY: number; maxY: number } {
  const c = Math.cos(angle),
    sn = Math.sin(angle);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    const lx = pts[k]![0],
      ly = pts[k]![1];
    const x = c * lx - sn * ly,
      y = sn * lx + c * ly;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/** Dozer-local quad → world-space quad (same vertex order, so the positive signed area is kept). */
function toWorld(s: DozerState, local: readonly V2[]): V2[] {
  const c = Math.cos(s.angle),
    sn = Math.sin(s.angle);
  return local.map(([lx, ly]) => [s.x + c * lx - sn * ly, s.y + sn * lx + c * ly]);
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const unit = (a: V2): V2 => mul(a, 1 / Math.hypot(a[0], a[1]));

/**
 * Thin push quad behind the image-px segment a → b (a = the end nearer the blade's left end), `depth` thick, ordered
 * back-left, front-left, front-right, back-right (positive shoelace area, geom.ts winding). Its front face is the
 * segment itself; its front normal (e.y, −e.x) points forward, away from the chassis.
 */
function pushQuad(a: V2, b: V2, depth: number): V2[] {
  const u = unit(sub(b, a));
  const n: V2 = [u[1], -u[0]];
  const back = mul(n, -depth);
  return [add(a, back), a, b, add(b, back)];
}

/** x where the line through p with direction d crosses image row y. */
const xAtY = (p: V2, d: V2, y: number): number => p[0] + ((y - p[1]) / d[1]) * d[0];

/**
 * Dozer quads in image px, all ordered back-left, front-left, front-right, back-right (positive shoelace area):
 *  - blade: BLADE_ART.pushDepth thick, behind the push line's main run (collision);
 *  - wing: the same behind the push line's lower run (collision; the two meet at the bend);
 *  - chassis: the outline of body plus tracks (CHASSIS_ART), front corners on the blade's and wing's back faces. Not
 *    simulated: walls only.
 */
export function dozerArtPolygons(): { chassis: V2[]; blade: V2[]; wing: V2[] } {
  const [p0, p1, p2] = BLADE_ART.pushLine as [V2, V2, V2];
  const D = BLADE_ART.pushDepth;
  const blade = pushQuad(p0, p1, D);
  const wing = pushQuad(p1, p2, D);
  const { rear, top, bottom } = CHASSIS_ART;
  const frontTop = xAtY(blade[0]!, sub(blade[3]!, blade[0]!), top) + MOUNT_OVERLAP;
  const frontBottom = xAtY(wing[0]!, sub(wing[3]!, wing[0]!), bottom) + MOUNT_OVERLAP;
  return {
    chassis: [
      [rear, top],
      [frontTop, top],
      [frontBottom, bottom],
      [rear, bottom],
    ],
    blade,
    wing,
  };
}

/** Dozer-local footprint (world px): dozerArtPolygons mapped through artToLocal (same vertex order), frozen. */
let localPolygonsCache: { chassis: V2[]; blade: V2[]; wing: V2[] } | null = null;
export function dozerLocalPolygons(): {
  readonly chassis: readonly V2[];
  readonly blade: readonly V2[];
  readonly wing: readonly V2[];
} {
  if (!localPolygonsCache) {
    const { chassis, blade, wing } = dozerArtPolygons();
    const local = (q: V2[]): V2[] => Object.freeze(q.map((p) => Object.freeze(artToLocal(p)) as V2)) as V2[];
    localPolygonsCache = Object.freeze({ chassis: local(chassis), blade: local(blade), wing: local(wing) });
  }
  return localPolygonsCache;
}

/** Mean dozer-local distance (world px) from the push line to the cutting edge along the blade and wing normals. */
export function scoopDepths(): { blade: number; wing: number } {
  const [e0, e1, e2] = BLADE_ART.cuttingEdge as [V2, V2, V2];
  const { blade, wing } = dozerArtPolygons();
  const depth = (q: V2[], a: V2, b: V2): number => {
    const n = unit(sub(q[1]!, q[0]!));
    const d = (p: V2): number => (p[0] - q[1]![0]) * n[0] + (p[1] - q[1]![1]) * n[1];
    return ((d(a) + d(b)) / 2) * spriteScale;
  };
  return { blade: depth(blade, e0, e1), wing: depth(wing, e1, e2) };
}

/** Dozer-local bounding box of the whole footprint (wall clamping, the intro's start and entry points). */
export function dozerExtents(): { minX: number; maxX: number; minY: number; maxY: number } {
  return extentsOf(footprintPoints());
}

/** World-space dozer quads: blade and wing (the only collision shapes) and the chassis outline (walls). */
export function dozerPolygons(s: DozerState): { chassis: V2[]; blade: V2[]; wing: V2[] } {
  const { chassis, blade, wing } = dozerLocalPolygons();
  return { chassis: toWorld(s, chassis), blade: toWorld(s, blade), wing: toWorld(s, wing) };
}

/** World-space position and velocity of a dozer-local point (rigid-body motion: v + ω × r). */
export function dozerPointMotion(s: DozerState, local: V2): { pos: V2; vel: V2 } {
  const [pos] = toWorld(s, [local]) as [V2];
  const rx = pos[0] - s.x,
    ry = pos[1] - s.y;
  return { pos, vel: [s.vx - s.angVel * ry, s.vy + s.angVel * rx] };
}

/** World-space blade sprite region (BLADE_ART.region): two quads with positive shoelace area. */
let regionLocal: readonly (readonly V2[])[] | null = null;
export function bladeRegion(s: DozerState): V2[][] {
  regionLocal ??= BLADE_ART.region.map((q) => q.map(artToLocal));
  return regionLocal.map((q) => toWorld(s, q));
}

/** World-space steel cutting edge (3 points, BLADE_ART.cuttingEdge): the front of the scoop zone. */
let edgeLocal: readonly V2[] | null = null;
export function cuttingEdge(s: DozerState): V2[] {
  edgeLocal ??= BLADE_ART.cuttingEdge.map(artToLocal);
  return toWorld(s, edgeLocal);
}

/** Forward speed (px/s) of a track's top run relative to the hull at lateral offset `y` (dozer-local, world px). */
export function trackSurfaceSpeed(s: DozerState, y: number): number {
  // Ground contact is stationary, so the top run moves forward relative to the hull at the ground speed of that side:
  // v_fwd − ω·y (ω > 0 turns right, towards +y, so the left track, y < 0, runs faster).
  const vFwd = s.vx * Math.cos(s.angle) + s.vy * Math.sin(s.angle);
  return vFwd - s.angVel * y;
}

const KEYS: Record<string, 'up' | 'down' | 'left' | 'right' | 'brake'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
};

/** Minimal document surface for visibility handling (a real Document, or a fake in tests). */
interface VisibilitySource extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

/**
 * Held-key tracker. Cmd/Ctrl/Alt chords are left to the browser (no preventDefault, not recorded) and clear the
 * held set, since macOS drops keyups while Cmd is down; held keys are also cleared on blur and when the page
 * becomes hidden.
 */
export function createKeyboard(
  target: EventTarget,
  doc: VisibilitySource | undefined = (target as Partial<Window>).document,
): { read(): DozerInput; clear(): void } {
  const held = new Set<string>();
  const onDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    // Typing into a page text field (interaction.ts): the keys belong to the field, not the dozer.
    if (isTextEntry(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) {
      held.clear();
      return;
    }
    if (!(e.code in KEYS)) return;
    e.preventDefault();
    held.add(e.code);
  };
  const onUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (!(e.code in KEYS)) return;
    if (!(e.metaKey || e.ctrlKey || e.altKey)) e.preventDefault();
    held.delete(e.code);
  };
  const onBlur = (): void => held.clear();
  const onVisibility = (): void => {
    if (doc?.visibilityState === 'hidden') held.clear();
  };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  doc?.addEventListener('visibilitychange', onVisibility);
  const has = (action: string): boolean => [...held].some((code) => KEYS[code] === action);
  const axis = (neg: string, pos: string): -1 | 0 | 1 => ((has(pos) ? 1 : 0) - (has(neg) ? 1 : 0)) as -1 | 0 | 1;
  return {
    read: () => ({ throttle: axis('down', 'up'), steer: axis('left', 'right'), brake: has('brake') }),
    /** Releases every held key (a page text field took the keyboard). */
    clear: () => held.clear(),
  };
}
