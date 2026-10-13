// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Port of gust's shd_fire as an SDF effect: flames off every edge, smoke above, a charred, ember-lit rim.
import type { SetUniforms } from './sdf';

export const FIRE_EFFECT = /* glsl */ `
uniform float uFade;     // 0 = no fire at all
uniform float uFlameLen;
uniform float uNoiseScale;
uniform float uSpeed;
uniform float uWobble;
uniform float uHeat;
uniform float uSmoke;
uniform float uEmber;
uniform float uNoBody;   // 1 = flames and smoke only, no panel

const float R = 220.0; // CSS px per gust UV unit

float dist_r(vec2 px) { return edge_dist(px) / R; }

vec4 effect(vec2 fp) {
  vec2 uv = fp / R;
  float t = uTime;
  vec4 sp = base(fp);
  float inside = smoothstep(0.45, 0.55, sp.a);
  float outside = 1.0 - inside;
  float d_here = dist_r(fp);
  vec4 body = vec4(0.0);
  vec3 light = vec3(0.0);

  // rising turbulence, domain-warped (y points down, so flames rise toward -y)
  vec2 np = vec2(uv.x, uv.y * 0.75) * uNoiseScale;
  vec2 drift = vec2(0.0, t * uSpeed);
  float warp = fbm(np * 1.9 + drift * 1.6);
  float n = fbm(np + drift + (warp - 0.5) * uWobble * 4.0);
  n = n * n * 1.6;

  float lift = uFlameLen * (0.25 + 0.9 * n);
  vec2 probe = fp + vec2((warp - 0.5) * uFlameLen * 0.8, lift) * R;
  float p_inside = smoothstep(0.45, 0.55, base(probe).a);
  float sd = dist_r(probe) * (1.0 - p_inside);
  float tongues = 1.0 - smoothstep(0.0, uFlameLen * 0.55, sd);

  float veil = 1.0 - smoothstep(0.0, uFlameLen * (0.35 + 0.85 * n), d_here);

  float heat = tongues * veil;
  heat *= 0.75 + 0.35 * vnoise(vec2(t * 8.0, uv.x * 40.0));
  heat = pow(clamp(heat, 0.0, 1.0), 1.5);

  vec3 fire = fire_palette(heat * (0.45 + 1.1 * uHeat)) * (0.7 + 0.6 * uHeat);
  float base_zone = 1.0 - smoothstep(0.0, uFlameLen * 0.4, d_here);
  vec3 blue = vec3(0.25, 0.45, 1.4) * pow(heat, 1.2);
  fire = mix(fire, blue, smoothstep(0.65, 1.0, uHeat) * base_zone * 0.8);

  vec2 probe2 = fp + vec2((warp - 0.5) * uFlameLen * 1.4, lift * 2.6) * R;
  float p2in = smoothstep(0.45, 0.55, base(probe2).a);
  float d2 = dist_r(probe2) * (1.0 - p2in);
  float plume = 1.0 - smoothstep(0.0, uFlameLen * 0.8, d2);
  float sm = fbm(np * 0.6 + drift * 0.55);
  float smoke = uSmoke * plume * (0.35 + 0.65 * sm) * (1.0 - heat) * outside;

  light += vec3(0.30, 0.28, 0.30) * smoke * 0.5;
  light += fire * outside;

  float char_zone = (1.0 - smoothstep(0.0, uFlameLen * 0.45, d_here)) * uFade;
  vec3 sprite_col = mix(sp.rgb, sp.rgb * 0.25 + vec3(0.05, 0.02, 0.01), char_zone * 0.8 * inside);
  float keep_body = 1.0 - uNoBody;
  body = over(body, sprite_col, sp.a * keep_body);

  float ember = inside * (1.0 - smoothstep(0.0, uFlameLen * 0.12, d_here));
  ember *= 0.7 + 0.3 * vnoise(vec2(uv.x * 60.0, t * 6.0));
  light += fire_palette(ember) * uEmber * keep_body;
  light += fire * inside * 0.12 * keep_body; // less than gust's 0.35 so text stays legible

  vec4 c = finish(body, light * uFade);
  c.a *= border_fade(fp, 40.0) * outside + inside;
  return c;
}`;

/** Intensity 0..1 to the gust shader's knobs; 0 means no fire at all. */
export const fireUniforms =
  (k: number): SetUniforms =>
  (gl, u) => {
    gl.uniform1f(u('uFade'), Math.min(1, k / 0.06));
    gl.uniform1f(u('uFlameLen'), 0.05 + 0.32 * k);
    gl.uniform1f(u('uNoiseScale'), 3.6);
    gl.uniform1f(u('uSpeed'), 0.7 + 0.6 * k);
    gl.uniform1f(u('uWobble'), 0.4);
    gl.uniform1f(u('uHeat'), 0.15 + 0.45 * k);
    gl.uniform1f(u('uSmoke'), 0.45 * k);
    gl.uniform1f(u('uEmber'), 0.25 + 0.75 * k);
  };
