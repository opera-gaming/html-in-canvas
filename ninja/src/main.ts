// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/*
 * HTML Ninja: canvas children captured into textures are tossed up and sliced by the pointer's blade; a cut splits a
 * target once into two spent pieces. The molotov bomb burns with the kit fire effect, and its flames-only render
 * feeds a screen-wide fire trail.
 */
import { FIRE_EFFECT, fireUniforms } from '@kit/fire-effect';
import { $, reducedMotion } from '@kit/dom';
import { captureInto, drawTo, fitCanvas, initGL, makeProgram, makeTexture } from '@kit/gl';
import { FULLSCREEN_UV_VS } from '@kit/shaders';
import { SdfEffect } from '@kit/sdf';
import { centroid, rectPoly, rotate, segmentHitsPoly, splitPoly, type Vec, type Vert } from './geom';
import { Renderer, type Point, type Splat } from './render';

type RGB = [number, number, number];
interface Template {
  el: HTMLElement;
  tex: WebGLTexture;
  juice: RGB;
  bomb: boolean;
  menu: boolean;
}
interface Body {
  tpl: Template;
  poly: Vert[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  cut: boolean;
  float: boolean;
}
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: RGB;
  spark: boolean;
}
interface Popup {
  el: HTMLElement;
  tex: WebGLTexture;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  punch: number;
  life: number;
  value: number;
  tilt: number;
  crit: boolean;
  active: boolean;
}

const SLICE_SPEED = 650; // px/s the blade must move to cut
const TRAIL_LIFE = 0.22; // s
const SPLAT_KEEP_TAU = 12; // s for the splatter to fade to ~37%

const canvas = $<HTMLCanvasElement>('view');
const gl = initGL(canvas, { float: true });
const R = new Renderer(gl);

const hexRgb = (hex: string): RGB => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

const templates: Template[] = [...canvas.querySelectorAll<HTMLElement>('.t')].map((el) => ({
  el,
  tex: makeTexture(gl, gl.LINEAR),
  juice: hexRgb(el.dataset.juice ?? '#ff3333'),
  bomb: el.hasAttribute('data-bomb'),
  menu: el.hasAttribute('data-menu'),
}));
const targets = templates.filter((t) => !t.bomb && !t.menu);
const bombTpl = templates.find((t) => t.bomb)!;
const menuTpl = templates.find((t) => t.menu)!;
const popups: Popup[] = [...canvas.querySelectorAll<HTMLElement>('.pop')].map((el) => ({
  el,
  tex: makeTexture(gl, gl.LINEAR),
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  age: 0,
  punch: 0,
  life: 1,
  value: 0,
  tilt: 0,
  crit: false,
  active: false,
}));
const captured = new Set<Element>();

// The burning bomb: the fire effect over the bomb's capture, into a texture of its field (the bottle plus room for flames).
// The bottle spins but its flames rise, so every frame the capture is turned into spinTex (a square that fits it at any
// angle) and the fire's distance field is rebuilt from that.
const BOMB_MARGIN = { top: 150, right: 60, bottom: 30, left: 60 };
const BOMB_HEAT = 0.8;
const bombFire = new SdfEffect(gl, FIRE_EFFECT);
const spinTex = makeTexture(gl, gl.LINEAR);
const spinP = makeProgram(
  gl,
  /* glsl */ `#version 300 es
precision highp float;
in vec2 v_vTexcoord;
out vec4 o;
uniform sampler2D uBase;
uniform vec2 uSize; // the capture's size over the square's side
uniform float uAngle;
void main() {
  vec2 p = v_vTexcoord - 0.5, c = vec2(cos(uAngle), sin(uAngle));
  vec2 uv = vec2(c.x * p.x + c.y * p.y, c.x * p.y - c.y * p.x) / uSize + 0.5; // p turned back by uAngle
  o = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))) ? texture(uBase, uv) : vec4(0.0);
}`,
  FULLSCREEN_UV_VS,
);
let spinSide = 0;
const fireTex = makeTexture(gl, gl.LINEAR);
const flamesTex = makeTexture(gl, gl.LINEAR); // flames only (no bottle), stamped into the fire trail
const fireFbo = gl.createFramebuffer();
let fireSize = { w: 0, h: 0 };
let firePoly: Vert[] = [];

/** Sizes the fire for the bomb's capture and rebuilds its distance field (on every capture of the bomb). */
function prepareBombFire(): void {
  spinSide = Math.ceil(Math.hypot(bombTpl.el.offsetWidth, bombTpl.el.offsetHeight));
  const w = spinSide,
    h = spinSide;
  bombFire.resize(w, h, BOMB_MARGIN);
  const { field } = bombFire;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const fw = Math.round(field.w * scale),
    fh = Math.round(field.h * scale);
  if (fw !== fireSize.w || fh !== fireSize.h) {
    for (const t of [fireTex, flamesTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const side = Math.round(spinSide * scale);
    gl.bindTexture(gl.TEXTURE_2D, spinTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    fireSize = { w: fw, h: fh };
  }
  // The field as a quad around the bomb's centre; the fire texture comes out GL way up, so v flips.
  const x0 = -BOMB_MARGIN.left - w / 2,
    y0 = -BOMB_MARGIN.top - h / 2;
  firePoly = [
    { x: x0, y: y0, u: 0, v: 1 },
    { x: x0 + field.w, y: y0, u: 1, v: 1 },
    { x: x0 + field.w, y: y0 + field.h, u: 1, v: 0 },
    { x: x0, y: y0 + field.h, u: 0, v: 0 },
  ];
}

/**
 * Renders the bomb, turned by `angle`, with its fire twice: whole (what the bomb is drawn with) and flames only (fed
 * to the trail).
 */
function renderBombFire(angle: number): void {
  gl.disable(gl.BLEND);
  gl.useProgram(spinP.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, bombTpl.tex);
  gl.uniform1i(spinP.u('uBase'), 0);
  gl.uniform2f(spinP.u('uSize'), bombTpl.el.offsetWidth / spinSide, bombTpl.el.offsetHeight / spinSide);
  gl.uniform1f(spinP.u('uAngle'), angle);
  const side = Math.round(spinSide * Math.min(2, window.devicePixelRatio || 1));
  drawTo(gl, fireFbo, spinTex, side, side);
  bombFire.build(spinTex);
  const heat = fireUniforms(BOMB_HEAT);
  for (const [tex, noBody] of [
    [fireTex, 0],
    [flamesTex, 1],
  ] as const) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fireFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, fireSize.w, fireSize.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    bombFire.draw(spinTex, { x: 0, y: 0 }, bombFire.field.h, fireSize.w / bombFire.field.w, now, (g, u) => {
      heat(g, u);
      g.uniform1f(u('uNoBody'), noBody);
    });
  }
}

let W = 1,
  H = 1;
let bodies: Body[] = [];
let drops: Drop[] = [];
let splats: Splat[] = [];
let trail: { x: number; y: number; t: number }[] = [];
let state: 'menu' | 'play' | 'over' = 'menu';
let score = 0;
let best = 0;
try {
  best = Number(localStorage.getItem('html-ninja-best')) || 0;
} catch {
  /* storage blocked */
}
let shake = 0;
let flash = 0;
let playTime = 0;
let nextWave = 0;
let pending: { at: number; fn: () => void }[] = [];
let now = performance.now() / 1000;
let popupSide = 1;
let swipe: { count: number; popup: Popup | null; lastFast: number } | null = null;

// ---------------------------------------------------------------- bodies

function makeBody(tpl: Template, x: number, y: number, vx: number, vy: number, float = false): Body {
  const w = tpl.el.offsetWidth,
    h = tpl.el.offsetHeight;
  return {
    tpl,
    poly: rectPoly(w, h),
    x,
    y,
    vx,
    vy,
    a: float ? 0 : rand(-0.4, 0.4),
    va: float ? 0 : rand(-2.5, 2.5),
    cut: false,
    float,
  };
}

function worldPoly(b: Body): Vec[] {
  return b.poly.map((v) => {
    const r = rotate(v, b.a);
    return { x: r.x + b.x, y: r.y + b.y };
  });
}

/** Tosses a target in: up from the bottom, or in and up from a side. */
function toss(tpl: Template): void {
  const G = H * 1.6;
  if (Math.random() < 0.5) {
    const x0 = rand(0.15, 0.85) * W,
      y0 = H + 90;
    const peak = rand(0.1, 0.42) * H;
    const vy = -Math.sqrt(2 * G * (y0 - peak));
    const T = -vy / G;
    const vx = ((W * rand(0.35, 0.65) - x0) / (2 * T)) * rand(0.5, 1.0);
    bodies.push(makeBody(tpl, x0, y0, vx, vy));
  } else {
    const left = Math.random() < 0.5;
    const x0 = left ? -110 : W + 110,
      y0 = rand(0.55, 0.85) * H;
    const peak = rand(0.15, 0.4) * H;
    const vy = -Math.sqrt(2 * G * Math.max(40, y0 - peak));
    const T = -vy / G;
    const vx = ((left ? 1 : -1) * (W * rand(0.3, 0.55))) / (1.3 * T);
    bodies.push(makeBody(tpl, x0, y0, vx, vy));
  }
}

function wave(): void {
  const n = 1 + Math.floor(Math.random() * Math.min(5, 2 + playTime / 12));
  const bomb = playTime > 4 && Math.random() < 0.35;
  for (let i = 0; i < n; i++)
    later(i * rand(0.12, 0.3), () => {
      if (state === 'play') toss(pick(targets));
    });
  if (bomb)
    later(rand(0.1, 0.5), () => {
      if (state === 'play') toss(bombTpl);
    });
}

function later(dt: number, fn: () => void): void {
  pending.push({ at: now + dt, fn });
}

function showMenu(title: string, sub: string, delay: number): void {
  $('menu-title').innerHTML = title;
  $('menu-sub').textContent = sub;
  // the capture of the new text lands well within the delay
  later(delay, () => {
    state = 'menu';
    bodies.push(makeBody(menuTpl, W / 2, H * 0.5, 0, 0, true));
  });
}

// ---------------------------------------------------------------- slicing

function slice(b: Body, a: Vec, dir: Vec): void {
  const local = rotate({ x: a.x - b.x, y: a.y - b.y }, -b.a);
  const ldir = rotate(dir, -b.a);
  const halves = splitPoly(b.poly, local, ldir);
  if (!halves) return;
  bodies = bodies.filter((x) => x !== b);
  const n = { x: -dir.y, y: dir.x };
  halves.forEach((half, i) => {
    const c = centroid(half);
    const wc = rotate(c, b.a);
    const s = i === 0 ? 1 : -1;
    bodies.push({
      tpl: b.tpl,
      poly: half.map((v) => ({ ...v, x: v.x - c.x, y: v.y - c.y })),
      x: b.x + wc.x,
      y: b.y + wc.y,
      vx: b.vx * 0.6 + n.x * s * rand(140, 220) + dir.x * 60,
      vy: Math.min(b.vy * 0.5, 0) + n.y * s * rand(140, 220) - 120,
      a: b.a,
      va: b.va + s * rand(2, 4),
      cut: true,
      float: false,
    });
  });
  juice(b, dir);
  playCut(b.tpl.bomb || b.tpl.menu ? 1 : (swipe?.count ?? 0) + 1);
  if (b.tpl.bomb) {
    playFail();
    explode(b);
  } else if (b.tpl.menu) {
    playLaugh();
    start();
  } else scoreHit(b);
}

function juice(b: Body, dir: Vec): void {
  const w = b.tpl.el.offsetWidth,
    h = b.tpl.el.offsetHeight;
  const size = Math.max(w, h);
  splats.push({
    x: b.x,
    y: b.y,
    dx: dir.x,
    dy: dir.y,
    len: size * 0.9,
    wid: size * 0.4,
    color: b.tpl.juice,
    streak: true,
  });
  const n = { x: -dir.y, y: dir.x };
  for (let i = 0; i < 22; i++) {
    const along = rand(-420, 420),
      across = rand(-260, 260);
    drops.push({
      x: b.x + rand(-10, 10),
      y: b.y + rand(-10, 10),
      vx: dir.x * along + n.x * across + b.vx * 0.3,
      vy: dir.y * along + n.y * across + b.vy * 0.3 - 150,
      age: 0,
      life: rand(0.35, 0.9),
      size: rand(5, 13),
      color: b.tpl.juice,
      spark: false,
    });
  }
}

function addShake(s: number): void {
  if (reducedMotion()) return;
  shake = Math.max(shake, s);
}

// ---------------------------------------------------------------- game flow

function start(): void {
  state = 'play';
  score = 0;
  playTime = 0;
  nextWave = now + 0.8;
  updateHud();
}

function explode(b: Body): void {
  state = 'over';
  if (!reducedMotion()) flash = 1; // the full-screen white flash
  addShake(28);
  for (const o of bodies) {
    if (o === b) continue;
    const dx = o.x - b.x,
      dy = o.y - b.y,
      d = Math.hypot(dx, dy) || 1;
    o.vx += (dx / d) * 900;
    o.vy += (dy / d) * 900 - 300;
    o.va += rand(-8, 8);
    o.cut = true;
  }
  for (let i = 0; i < 80; i++) {
    const ang = rand(0, Math.PI * 2),
      sp = rand(200, 1100);
    drops.push({
      x: b.x,
      y: b.y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      age: 0,
      life: rand(0.3, 0.9),
      size: rand(4, 12),
      color: pick<RGB>([
        [1, 0.85, 0.3],
        [1, 0.4, 0.1],
        [1, 1, 1],
        [1, 0.1, 0.18],
      ]),
      spark: true,
    });
  }
  const p = takePopup();
  setPopup(p, 'boom', 'BOOM!', 0, b.x, b.y - 40);
  if (score > best) {
    best = score;
    try {
      localStorage.setItem('html-ninja-best', String(best));
    } catch {
      /* storage blocked */
    }
  }
  updateHud();
  showMenu('GAME<br />OVER', `Score ${score} · slice to retry`, 1.6);
}

function updateHud(): void {
  $('score').textContent = String(score);
  $('best').textContent = `BEST ${best}`;
  const hud = $('hud');
  hud.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], {
    duration: 220,
    easing: 'cubic-bezier(.2,1.6,.4,1)',
  });
}

// ---------------------------------------------------------------- juicy numbers

function takePopup(): Popup {
  const free = popups.find((p) => !p.active) ?? popups.reduce((a, b) => (a.age > b.age ? a : b));
  free.active = true;
  return free;
}

/** (Re)labels a popup; `x`, `y` set its spawn point (thrown to alternating sides, with a random offset). */
function setPopup(p: Popup, kind: 'hit' | 'combo' | 'boom', html: string, value: number, x?: number, y?: number): void {
  p.el.className = kind === 'hit' ? 'pop' : `pop ${kind}`;
  p.el.innerHTML = html;
  p.value = value;
  p.punch = 0; // pop it in: every change punches the scale again
  if (x !== undefined && y !== undefined) {
    popupSide = -popupSide;
    p.x = x + popupSide * rand(30, 80);
    p.y = y + rand(-50, -20);
    p.vx = popupSide * rand(80, 170);
    p.vy = -rand(380, 480);
    p.age = 0;
    p.tilt = 0;
    p.crit = false;
  } else {
    p.age = Math.min(p.age, 0.15); // a stacked hit keeps the number in the air
    p.vy = Math.min(p.vy, -260);
  }
  p.life = kind === 'hit' ? 1.0 : 1.5;
  if (kind !== 'hit' && !p.crit) {
    p.crit = true; // the crit: bigger, tilted, shaking, sparks, and the camera feels it
    p.tilt = popupSide * rand(0.12, 0.24);
    addShake(12);
    for (let i = 0; i < 26; i++) {
      const ang = rand(0, Math.PI * 2),
        sp = rand(150, 600);
      drops.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 150,
        age: 0,
        life: rand(0.3, 0.7),
        size: rand(4, 9),
        color: [1, 0.8, 0.25],
        spark: true,
      });
    }
  }
}

function scoreHit(b: Body): void {
  if (!swipe) swipe = { count: 0, popup: null, lastFast: now };
  swipe.count += 1;
  const gain = 10 * swipe.count; // each further hit in one swipe is worth more
  score += gain;
  updateHud();
  const total = (swipe.popup?.value ?? 0) + gain;
  const kind = swipe.count >= 3 ? 'combo' : 'hit';
  if (swipe.count === 3) playCheer(); // the moment a swipe becomes a combo
  const html = kind === 'combo' ? `+${total}<small>COMBO ×${swipe.count}</small>` : `+${total}`;
  // stack fast hits: one number per swipe, climbing
  if (swipe.popup?.active) setPopup(swipe.popup, kind, html, total);
  else {
    swipe.popup = takePopup();
    setPopup(swipe.popup, kind, html, total, b.x, b.y);
  }
}

// ---------------------------------------------------------------- input

/** A blade sample at (x, y), `t` the event's own time in s (coalesced events in one frame each have theirs). */
function onMove(x: number, y: number, t: number): void {
  const last = trail[trail.length - 1];
  trail.push({ x, y, t });
  if (!last) return;
  const dt = Math.max(1e-3, t - last.t);
  const speed = Math.hypot(x - last.x, y - last.y) / dt;
  if (speed < SLICE_SPEED) return;
  if (swipe) swipe.lastFast = now;
  const a = { x: last.x, y: last.y },
    b = { x, y };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  for (const body of [...bodies]) {
    if (body.cut) continue;
    if (segmentHitsPoly(a, b, worldPoly(body))) slice(body, a, dir);
  }
}

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  for (const ev of e.getCoalescedEvents?.() ?? [e])
    onMove(ev.clientX - r.left, ev.clientY - r.top, ev.timeStamp / 1000);
});
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  trail = [{ x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp / 1000 }];
});
const endSwipe = (): void => {
  swipe = null;
};
canvas.addEventListener('pointerup', endSwipe);
canvas.addEventListener('pointerleave', () => {
  endSwipe();
  trail = [];
});

// ---------------------------------------------------------------- frame

function step(dt: number): void {
  const G = H * 1.6;
  if (state === 'play') {
    playTime += dt;
    if (now >= nextWave) {
      wave();
      nextWave = now + Math.max(0.9, 2.2 - playTime / 40) + rand(0, 0.6);
    }
  }
  for (const p of pending.filter((p) => p.at <= now)) p.fn();
  pending = pending.filter((p) => p.at > now);
  if (swipe && now - swipe.lastFast > 0.25) swipe = null;

  for (const b of bodies) {
    if (b.float) {
      b.y = H * 0.5 + Math.sin(now * 1.6) * 10;
      b.x = W / 2;
      b.a = Math.sin(now * 0.9) * 0.05;
      continue;
    }
    b.vy += G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.a += b.va * dt;
  }
  bodies = bodies.filter((b) => b.y < H + 400 && b.x > -500 && b.x < W + 500);

  for (const d of drops) {
    d.vy += G * (d.spark ? 0.6 : 0.9) * dt;
    d.vx *= 1 - 1.2 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.age += dt;
    // a juice drop that runs out lands on the board
    if (!d.spark && d.age >= d.life)
      splats.push({
        x: d.x,
        y: d.y,
        dx: 1,
        dy: 0,
        len: d.size * 1.4,
        wid: d.size * 1.4,
        color: d.color,
        streak: false,
      });
  }
  drops = drops.filter((d) => d.age < d.life);

  for (const p of popups) {
    if (!p.active) continue;
    p.age += dt;
    p.punch += dt;
    p.vy += 1100 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.age > p.life) p.active = false;
  }

  shake *= Math.exp(-8 * dt);
  flash = Math.max(0, flash - dt / 0.6);
  trail = trail.filter((t) => now - t.t < TRAIL_LIFE);
}

function draw(dt: number): void {
  const sh = { x: rand(-1, 1) * shake, y: rand(-1, 1) * shake };
  const ready = (el: Element): boolean => captured.has(el);
  const burning = (b: Body): boolean => b.tpl.bomb && !b.cut && firePoly.length > 0;
  const bombs = bodies.filter(burning);
  // One fire texture serves every burning bomb, so they share the first one's angle.
  for (const b of bombs) b.a = bombs[0]!.a;
  if (bombs.length) renderBombFire(bombs[0]!.a);
  R.updateFireTrail(
    dt,
    now,
    bombs.map((b) => ({ tex: flamesTex, verts: firePoly, x: b.x, y: b.y })),
  );
  R.updateSplatter(Math.exp(-dt / SPLAT_KEEP_TAU), splats);
  splats = [];
  R.begin(sh);

  for (const b of bodies)
    if (ready(b.tpl.el)) R.poly(b.tpl.tex, b.poly, b.x + sh.x + 10, b.y + sh.y + 14, b.a, 1, 1, true);
  R.fireTrail();
  for (const b of bodies) {
    if (!ready(b.tpl.el)) continue;
    if (burning(b)) R.poly(fireTex, firePoly, b.x + sh.x, b.y + sh.y, 0, 1, 1, false);
    else R.poly(b.tpl.tex, b.poly, b.x + sh.x, b.y + sh.y, b.a, 1, 1, false);
  }

  const pts: Point[] = drops.map((d) => {
    const fade = 1 - Math.max(0, (d.age - d.life * 0.6) / (d.life * 0.4));
    return {
      x: d.x + sh.x,
      y: d.y + sh.y,
      size: d.size * (d.spark ? fade : 1),
      color: [...d.color, d.spark ? fade : 1] as [number, number, number, number],
    };
  });
  R.points(pts);

  for (const p of popups) {
    if (!p.active || !ready(p.el)) continue;
    const base = 0.75 + (Math.min(p.value, 300) / 300) * 0.7; // size = score
    const punch = 1 + 0.75 * Math.exp(-p.punch * 9) * Math.cos(p.punch * 22);
    const fadeFrom = p.life * 0.55;
    const alpha = p.age < fadeFrom ? 1 : Math.max(0, 1 - (p.age - fadeFrom) / (p.life - fadeFrom));
    const jitter = p.crit ? 6 * Math.exp(-p.age * 5) : 0;
    const w = p.el.offsetWidth,
      h = p.el.offsetHeight;
    R.poly(
      p.tex,
      rectPoly(w, h),
      p.x + sh.x + rand(-jitter, jitter),
      p.y + sh.y + rand(-jitter, jitter),
      p.tilt,
      base * punch,
      alpha,
      false,
    );
  }

  const tnow = now;
  R.trail(
    trail.map((t) => ({ x: t.x, y: t.y, life: Math.max(0, 1 - (tnow - t.t) / TRAIL_LIFE) })),
    16,
  );
  R.flash(flash * flash);
}

let last = performance.now();
function frame(): void {
  requestAnimationFrame(frame);
  const t = performance.now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  now = t / 1000;
  fitCanvas(canvas);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  R.resize(W, H, canvas.width / W);
  step(dt);
  draw(dt);
}

// Capture whichever canvas children repainted (the clock ticks, the spinner spins, popups change text).
canvas.addEventListener('paint', (ev) => {
  const changed = (ev as Event & { changedElements?: Element[] }).changedElements;
  for (const t of templates) {
    if (changed && changed.includes(t.el) === false && captured.has(t.el)) continue;
    captureInto(gl, t.tex, t.el);
    captured.add(t.el);
    if (t.bomb) prepareBombFire();
  }
  for (const p of popups)
    if (!changed || changed.includes(p.el) || !captured.has(p.el)) {
      captureInto(gl, p.tex, p.el);
      captured.add(p.el);
    }
});

// Cut sounds: random clip, slight pitch spread, rising with each further hit in a swipe. Slicing the bomb also plays
// the fail sound, the start card a laugh, and a swipe turning into a combo a random cheer.
const sfx = new AudioContext();
const cuts: AudioBuffer[] = [];
let fail: AudioBuffer | null = null; // slicing the molotov
const cheers: AudioBuffer[] = []; // a swipe becoming a combo
let laugh: AudioBuffer | null = null; // slicing the start (or retry) card
const loadClip = (name: string, use: (buf: AudioBuffer) => void): void => {
  fetch(`${import.meta.env.BASE_URL}audio/${name}.ogg`)
    .then((r) => r.arrayBuffer())
    .then((data) => sfx.decodeAudioData(data))
    .then(use)
    .catch(() => {
      /* a missing or undecodable clip just stays silent */
    });
};
for (const name of ['cut001', 'cut002', 'cut003']) loadClip(name, (buf) => cuts.push(buf));
loadClip('fail', (buf) => (fail = buf));
for (const name of ['yeah', 'combo', 'woo']) loadClip(name, (buf) => cheers.push(buf));
loadClip('laugh', (buf) => (laugh = buf));
function unlockSfx(): void {
  if (sfx.state === 'suspended') sfx.resume().catch(() => {});
}
function playCut(combo: number): void {
  if (!cuts.length || sfx.state !== 'running') return;
  const src = sfx.createBufferSource();
  src.buffer = pick(cuts);
  src.playbackRate.value = rand(0.92, 1.08) * (1 + 0.07 * Math.max(0, combo - 1));
  const gain = sfx.createGain();
  gain.gain.value = 0.8;
  src.connect(gain).connect(sfx.destination);
  src.start();
}
function playClip(buf: AudioBuffer | null | undefined): void {
  if (!buf || sfx.state !== 'running') return;
  const src = sfx.createBufferSource();
  src.buffer = buf;
  src.connect(sfx.destination);
  src.start();
}
const playFail = (): void => playClip(fail);
// Cheers come from a shuffle bag: every cheer plays once per round in a random order, and a new round never opens with
// the one that just played, so the same cheer never comes twice in a row.
let cheerBag: AudioBuffer[] = [];
let lastCheer: AudioBuffer | null = null;
const nextCheer = (): AudioBuffer | null => {
  if (!cheers.length) return null;
  if (!cheerBag.length) {
    cheerBag = [...cheers];
    for (let i = cheerBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cheerBag[i], cheerBag[j]] = [cheerBag[j]!, cheerBag[i]!];
    }
    // The bag is drawn from the end: if that is the cheer just played, swap it to the front.
    if (cheerBag.length > 1 && cheerBag[cheerBag.length - 1] === lastCheer)
      [cheerBag[0], cheerBag[cheerBag.length - 1]] = [cheerBag[cheerBag.length - 1]!, cheerBag[0]!];
  }
  lastCheer = cheerBag.pop()!;
  return lastCheer;
};
const playCheer = (): void => playClip(nextCheer());
const playLaugh = (): void => playClip(laugh);

// Music ("Little Chaos" by Ketsa, CC BY 4.0, credited on the page), on by default. Autoplay is allowed when arriving
// by a click from the landing page; otherwise it starts on the first click, tap or key press (mouse moves don't count).
const music = new Audio(`${import.meta.env.BASE_URL}audio/little-chaos.mp3`);
music.loop = true;
music.volume = 0.55;
const soundBtn = $<HTMLButtonElement>('sound');
let musicWanted = true;
try {
  musicWanted = localStorage.getItem('html-ninja-music') !== 'off';
} catch {
  /* storage blocked */
}
const syncSound = (): void => {
  const playing = !music.paused;
  // The visible text follows the state; the accessible name stays "Music" and aria-pressed carries the state.
  soundBtn.textContent = playing ? '♪ Music on' : '♪ Play music';
  soundBtn.setAttribute('aria-pressed', String(playing));
};
music.addEventListener('play', syncSound);
music.addEventListener('pause', syncSound);
const startMusic = (e: Event): void => {
  unlockSfx();
  if (e.target === soundBtn || !musicWanted || !music.paused) return;
  music.play().catch(() => {
    /* not allowed yet */
  });
};
window.addEventListener('pointerdown', startMusic);
window.addEventListener('keydown', startMusic);
if (musicWanted)
  music.play().catch(() => {
    /* not allowed until a click, tap or key press */
  });
unlockSfx();
soundBtn.addEventListener('click', () => {
  musicWanted = music.paused;
  if (musicWanted)
    music.play().catch(() => {
      /* not allowed */
    });
  else music.pause();
  try {
    localStorage.setItem('html-ninja-music', musicWanted ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
});

// The clock target keeps real time: a sliced clock keeps ticking in both halves.
const clock = $('t-clock');
setInterval(() => {
  const time = new Date().toLocaleTimeString('en-GB');
  if (clock.textContent !== time) clock.textContent = time;
}, 250);

document.fonts.ready.then(() => canvas.requestPaint!());
canvas.requestPaint!();
showMenu('HTML<br />NINJA', 'Slice me to start', 0.3);
requestAnimationFrame(frame);
