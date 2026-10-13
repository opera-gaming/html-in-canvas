// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// High Voltage: port of gust's shd_electric (jittered aura, filaments, charged rim); the voltage slider sets how much.
import { $, reducedMotion } from '@kit/dom';
import { colourValue, createStage, rangeValue } from '@kit/stage';

const EFFECT = /* glsl */ `
uniform float uFade;      // 0 = no charge at all
uniform float uAuraLen;
uniform float uDensity;
uniform float uFlicker;
uniform float uJag;
uniform float uBoltScale;
uniform float uThick;
uniform vec3 uArc;        // gust's ec

const float R = 300.0; // CSS px per gust UV unit

float dist_r(vec2 r) { return edge_dist(r * R) / R; }

vec4 effect(vec2 fp) {
  vec2 uv = fp / R;
  float t = uTime;
  vec4 sp = base(fp);
  float inside = smoothstep(0.45, 0.55, sp.a);
  float outside = 1.0 - inside;
  float d_here = dist_r(uv);
  vec4 body = vec4(0.0);
  vec3 light = vec3(0.0);

  float tq = floor(t * uFlicker);
  vec2 jolt = vec2(hash(vec2(tq, 1.7)), hash(vec2(tq, 9.1))) * 8.0;

  vec2 wig = (vec2(fbm(uv * uBoltScale + jolt), fbm(uv * uBoltScale + jolt + vec2(37.2, 17.9))) - 0.5) * uJag;
  vec2 q = uv + wig;
  float d = dist_r(q);

  vec2 s = edge_seed(q * R) / R;
  float along = s.x < 0.0 ? 0.0 : fbm(s * uBoltScale * 1.5 + jolt);
  float a0 = 0.78 - uDensity * 0.5;
  float gate = smoothstep(a0, a0 + 0.15, along);
  float reach = uAuraLen * (0.15 + 0.85 * along);
  float rad = 1.0 - smoothstep(0.0, reach, d);
  float bolt = gate * rad * rad * rad;

  float n1 = fbm(q * uBoltScale * 2.5 + jolt + vec2(51.3, 7.9)) - 0.5;
  float core = (1.0 - smoothstep(uThick * 0.35, uThick, abs(n1))) * (1.0 - smoothstep(0.0, uAuraLen, d)) * (0.35 + 0.65 * gate);

  float corona = pow(clamp(1.0 - d / uAuraLen, 0.0, 1.0), 3.0) * 0.25;
  float e = (bolt * 0.9 + core * 1.5 + corona) * (0.8 + 0.4 * hash(vec2(tq, 4.2)));

  vec3 ec = uArc;
  light += ec * e * outside + vec3(0.9, 0.95, 1.3) * core * outside * 1.1;
  body = over(body, sp.rgb, sp.a);
  float rim = exp(-d_here / (uAuraLen * 0.12)) * inside;
  light += ec * rim * (0.5 + 0.5 * hash(vec2(tq, 8.8)));
  light += ec * e * inside * 0.3;

  vec4 c = finish(body, light * uFade);
  c.a *= border_fade(fp, 30.0) * outside + inside;
  return c;
}`;

const voltage = rangeValue($('voltage'), (v) => `${v}%`);
const flicker = rangeValue($('flicker'));
const jag = rangeValue($('jag'), (v) => `${v}%`);
const detail = rangeValue($('detail'));
const arc = colourValue($('colour'), { accent: true });

createStage({
  canvas: $('view'),
  panel: $('panel'),
  margin: { top: 130, right: 130, bottom: 130, left: 130 },
  place: (cw, ch, pw, ph) => ({ x: (cw - pw) / 2, y: Math.max(130, (ch - ph) / 2) }),
  effect: EFFECT,
  // The slider spans only the bottom 20% of gust's range; above that the aura swamps the panel.
  uniforms: (gl, u) => {
    const s = voltage() / 100;
    const k = s * 0.2;
    gl.uniform1f(u('uFade'), Math.min(1, s / 0.06));
    gl.uniform1f(u('uAuraLen'), 0.05 + 0.25 * k);
    gl.uniform1f(u('uDensity'), 0.5 + 0.5 * k);
    // Reduced motion holds the arcs still at a steady brightness instead of re-rolling them 2-30 times a second.
    gl.uniform1f(u('uFlicker'), reducedMotion() ? 0 : flicker());
    gl.uniform1f(u('uJag'), (jag() / 100) * 0.06);
    gl.uniform1f(u('uBoltScale'), detail());
    gl.uniform1f(u('uThick'), 0.03);
    // gust's arc colour (0.45, 0.6, 1.6) is brighter than white; scale the picked colour to match.
    const [r, g, b] = arc();
    const m = 1.6 / Math.max(r, g, b, 1e-3);
    gl.uniform3f(u('uArc'), r * m, g * m, b * m);
  },
});
