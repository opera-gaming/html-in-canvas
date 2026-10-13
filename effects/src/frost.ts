// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Frosty Checkboxes: gust's shd_frost with a per-row mask, so frost grows only off the edges of ticked rows (found
// through the nearest-edge texture).
import { createStage, rangeValue } from '@kit/stage';

const ROWS = 4;

const EFFECT = /* glsl */ `
uniform float uWatReach;
uniform float uWatSpeed;
uniform float uWatScale;
uniform float uWatSheen;
uniform vec4 uRows[${ROWS}]; // each row's rect in field px
uniform float uFrost[${ROWS}]; // 0 clear .. 1 frosted

const float R = 300.0; // CSS px per gust UV unit
const int ROWS = ${ROWS};

float dist_r(vec2 r) { return edge_dist(r * R) / R; }

// How frosted the row holding px is. Given an edge_seed position, whether that edge belongs to a ticked row.
float row_frost(vec2 px) {
  if (px.x < 0.0) return 0.0;
  float w = 0.0;
  for (int i = 0; i < ROWS; i++) {
    vec4 r = uRows[i];
    float x = step(r.x - 4.0, px.x) * step(px.x, r.x + r.z + 4.0);
    float y = step(r.y - 4.0, px.y) * step(px.y, r.y + r.w + 4.0);
    w = max(w, uFrost[i] * x * y);
  }
  return w;
}

vec3 water_palette(float h0) {
  float h = clamp(h0, 0.0, 1.0);
  vec3 c = mix(vec3(0.02, 0.09, 0.22), vec3(0.1, 0.55, 0.85), h);
  return c + vec3(0.9) * pow(h, 6.0);
}

vec4 effect(vec2 fp) {
  vec2 uv = fp / R;
  float t = uTime;
  vec4 sp = base(fp);
  float inside = smoothstep(0.45, 0.55, sp.a);
  float outside = 1.0 - inside;
  float d_here = dist_r(uv);
  vec4 body = vec4(0.0);
  vec3 light = vec3(0.0);
  float own = row_frost(fp);              // fp is on a ticked row
  float near = row_frost(edge_seed(fp));  // the nearest edge is a ticked row's

  vec2 np = uv * uWatScale;
  float n = fbm(np - vec2(0.0, t * uWatSpeed));
  n = n * n * 1.5;
  float lift = uWatReach * (0.15 + 0.85 * n);
  vec2 probe = uv - vec2((n - 0.5) * uWatReach * 0.35, lift);
  float from_ticked = row_frost(edge_seed(probe * R)); // the edge this frost grows from is a ticked row's
  float pin = smoothstep(0.45, 0.55, base(probe * R).a);
  float sdp = dist_r(probe) * (1.0 - pin);
  float drip = 1.0 - smoothstep(0.0, uWatReach * 0.35, sdp);
  float veil = 1.0 - smoothstep(0.0, uWatReach * (0.3 + 0.5 * n), d_here);
  float wet = pow(clamp(drip * veil, 0.0, 1.0), 1.3) * from_ticked;

  light += water_palette(wet) * (wet * 0.9 + veil * near * 0.1) * outside;
  float spark = pow(vnoise(uv * 90.0 - vec2(0.0, t * 3.0)), 9.0);
  light += vec3(0.8, 0.95, 1.0) * spark * wet * outside * uWatSheen;
  body = over(body, sp.rgb, sp.a);
  float sheen = exp(-d_here / (uWatReach * 0.35)) * inside * own;
  float caust = pow(fbm(uv * 10.0 + vec2(t * 0.2, t * 0.35)), 3.0);
  light += vec3(0.15, 0.5, 0.8) * sheen * (0.4 + 2.0 * caust) * uWatSheen;

  vec4 c = finish(body, light);
  c.a *= border_fade(fp, 30.0) * outside + inside;
  return c;
}`;

const panel = document.getElementById('panel') as HTMLElement;
const rows = [...panel.querySelectorAll<HTMLLabelElement>('.item')];
const boxes = rows.map((r) => r.querySelector<HTMLInputElement>('input')!);
const frost = rows.map(() => 0);
const knob = (id: string, digits: number): HTMLInputElement => {
  const el = document.getElementById(id) as HTMLInputElement;
  rangeValue(el, (v) => v.toFixed(digits));
  return el;
};
const knobs = {
  reach: knob('reach', 3),
  flow: knob('flow', 2),
  waviness: knob('waviness', 1),
  sheen: knob('sheen', 2),
};
document.getElementById('reset')!.addEventListener('click', () => {
  for (const el of Object.values(knobs)) {
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  }
});
// room for the largest reach (0.35 × R)
const MARGIN = { top: 120, right: 120, bottom: 120, left: 120 };
let last = performance.now();
let rects: number[] = []; // each row's rect in field px, measured on every layout (the panel's own transform cancels out)
const measureRows = (): void => {
  const p = panel.getBoundingClientRect();
  rects = rows.flatMap((r) => {
    const b = r.getBoundingClientRect();
    return [b.left - p.left + MARGIN.left, b.top - p.top + MARGIN.top, b.width, b.height];
  });
};

createStage({
  canvas: document.getElementById('view') as HTMLCanvasElement,
  panel,
  margin: MARGIN,
  // Runs on every layout (each repaint of the panel and each resize), so the row rects are re-measured with it.
  place: (cw, ch, pw, ph) => {
    measureRows();
    return { x: (cw - pw) / 2, y: Math.max(MARGIN.top + 16, (ch - ph) / 2 - 40) };
  },
  effect: EFFECT,
  uniforms: (gl, u) => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    boxes.forEach((b, i) => {
      frost[i] = b.checked ? Math.min(1, frost[i]! + dt / 0.6) : Math.max(0, frost[i]! - dt / 1.2);
    });
    gl.uniform4fv(u('uRows'), rects);
    gl.uniform1fv(u('uFrost'), frost);
    gl.uniform1f(u('uWatReach'), Number(knobs.reach.value));
    gl.uniform1f(u('uWatSpeed'), Number(knobs.flow.value));
    gl.uniform1f(u('uWatScale'), Number(knobs.waviness.value));
    gl.uniform1f(u('uWatSheen'), Number(knobs.sheen.value));
  },
});
