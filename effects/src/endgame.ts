// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Dust to Dust: port of gust's shd_endgame (petrify, crumble into wind-blown dust). Gust loops it on a timer; here
// its cycle position tc runs 0..0.95 with the switch.
import { $ } from '@kit/dom';
import { belowControls, colourValue, createStage, rangeValue, switchPhase } from '@kit/stage';

const EFFECT = /* glsl */ `
uniform float uTc;     // gust's cycle position: 0..0.2 petrify, 0.2..0.65 crumble, 0.85..0.95 fade
uniform float uCycle;
uniform float uGrain;
uniform float uSweep;
uniform float uReach;
uniform float uDust;
uniform vec3 uColour;

const float R = 500.0; // CSS px per gust UV unit
const vec2 WIND = vec2(0.85, -0.5);
const int DUST_SAMPLES = 6;

vec3 stone(vec3 c) {
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  return (0.12 + 0.85 * lum) * uColour * 2.0;
}

// The crumble front at field px. Clamped to 0.02..1 (the cut starts below it): unlike gust's sprites the panel reaches
// the texture's edge, which would otherwise crumble at rest.
float front(vec2 px, float ci) {
  float n = clamp((fbm(px / R * uGrain + ci * 7.1) - 0.2) / 0.6, 0.0, 1.0);
  float ey = (px.y - uElem.y) / uElem.w;
  return clamp(mix(n, 1.0 - ey + (n - 0.5) * 0.25, uSweep), 0.02, 1.0);
}

vec4 effect(vec2 fp) {
  vec2 uv = fp / R;
  vec4 sp = base(fp);
  vec4 body = vec4(0.0);
  vec3 light = vec3(0.0);

  float tc = uTc;
  float ci = uCycle;
  float petrify = smoothstep(0.0, 0.2, tc);
  float vis = 1.0 - smoothstep(0.85, 0.95, tc);

  float edge = 0.06;
  float cut = (tc - 0.2) / 0.45 * (1.0 + edge) - edge;
  float f = front(fp, ci);
  float keep = smoothstep(cut, cut + 0.015, f);
  float band = keep * (1.0 - smoothstep(0.0, edge, f - cut));
  vec3 col = mix(sp.rgb, stone(sp.rgb), petrify) * (1.0 - 0.45 * band);
  body = over(body, col, sp.a * keep);

  float blow = uReach * max(cut, 0.0);
  vec2 grain = floor(fp * 1.8) + ci;
  float grit = hash(grain);
  float life = mix(0.15, 0.8, hash(grain * 1.3 + 7.0));
  float dust = 0.0;
  vec3 dust_col = vec3(0.0);
  for (int k = 0; k < DUST_SAMPLES; k++) {
    float s = (float(k) + hash(uv * 37.0 + float(k))) / float(DUST_SAMPLES);
    vec2 src = fp - WIND * blow * s * (0.6 + 0.8 * vnoise(uv * 30.0 + float(k))) * R;
    vec4 smp = base(src);
    float age = cut - front(src, ci);
    float gone = smoothstep(0.0, 0.015, age);
    float alive = 1.0 - smoothstep(0.5 * life, life, age);
    float a = smp.a * gone * alive * (1.0 - s) * step(1.0 - uDust, grit);
    dust_col += stone(smp.rgb) * a;
    dust += a;
  }
  if (dust > 0.0) { dust_col /= dust; }
  dust = min(dust * 0.9, 1.0);
  body = over(body, dust_col * (0.8 + 0.4 * grit), dust);

  vec4 c = finish(body, light);
  c.a *= border_fade(fp, 30.0) * vis;
  return c;
}`;

const panel = $<HTMLElement>('panel');
const colour = colourValue($('colour'));
const speed = rangeValue($('speed'), (v) => `${v.toFixed(1)}s`);
const grain = rangeValue($('grain'));
const sweep = rangeValue($('sweep'), (v) => `${v}%`);
const blow = rangeValue($('blow'), (v) => `${v}%`);
const dust = rangeValue($('dust'), (v) => `${v}%`);
const trip = switchPhase($('toggle'), panel, speed);

createStage({
  canvas: $('view'),
  panel,
  // the wind blows the dust right and up
  margin: { top: 220, right: 340, bottom: 40, left: 40 },
  place: belowControls($('controls')),
  effect: EFFECT,
  uniforms: (gl, u) => {
    trip.tick();
    gl.uniform1f(u('uTc'), trip.state.phase * 0.95);
    gl.uniform1f(u('uCycle'), trip.state.cycle);
    gl.uniform1f(u('uGrain'), grain());
    gl.uniform1f(u('uSweep'), sweep() / 100);
    gl.uniform1f(u('uReach'), blow() / 100);
    gl.uniform1f(u('uDust'), dust() / 100);
    gl.uniform3f(u('uColour'), ...colour());
  },
});
