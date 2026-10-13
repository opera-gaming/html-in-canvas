// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Offscreen textures use CSS orientation (row 0 = top, y down); shaders work in field CSS px.

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** FULLSCREEN_VS plus `v_vTexcoord`, 0..1 across the viewport with y up (the GameMaker prefabs' convention). */
export const FULLSCREEN_UV_VS = /* glsl */ `#version 300 es
out vec2 v_vTexcoord;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_vTexcoord = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The captured panel's colour at a field position in CSS px (transparent outside the panel).
const BASE = /* glsl */ `
uniform sampler2D uBase;
uniform vec4 uElem; // panel rect inside the field, CSS px (x, y, w, h)
vec4 base(vec2 px) {
  vec2 uv = (px - uElem.xy) / uElem.zw;
  float in_rect = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return textureLod(uBase, clamp(uv, 0.0, 1.0), 0.0) * in_rect;
}`;

/** Jump-flood seeds: .xy = this texel if it is inside the silhouette, .zw = this texel if it is outside. */
export const SEED_FS = /* glsl */ `#version 300 es
precision highp float;
${BASE}
uniform float uScale; // field texels per CSS px
out vec4 o;
void main() {
  vec2 px = gl_FragCoord.xy;
  bool inside = base(px / uScale).a > 0.5;
  o = inside ? vec4(px, -1.0, -1.0) : vec4(-1.0, -1.0, px);
}`;

/** One jump-flood step: keeps the nearest inside and the nearest outside seed among the 3x3 neighbours at uStep. */
export const JFA_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform float uStep;
out vec4 o;
void main() {
  ivec2 size = textureSize(uPrev, 0);
  vec2 px = gl_FragCoord.xy;
  vec2 bestIn = vec2(-1.0), bestOut = vec2(-1.0);
  float dIn = 1e20, dOut = 1e20;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = ivec2(px + vec2(x, y) * uStep);
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      vec4 s = texelFetch(uPrev, q, 0);
      if (s.x >= 0.0) { float d = distance(px, s.xy); if (d < dIn) { dIn = d; bestIn = s.xy; } }
      if (s.z >= 0.0) { float d = distance(px, s.zw); if (d < dOut) { dOut = d; bestOut = s.zw; } }
    }
  }
  o = vec4(bestIn, bestOut);
}`;

/** Distance to the silhouette edge, inside or out, in CSS px. */
export const DIST_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSeeds;
uniform float uScale;
out vec4 o;
void main() {
  vec2 px = gl_FragCoord.xy;
  vec4 s = texelFetch(uSeeds, ivec2(px), 0);
  // An inside texel measures to the nearest outside seed and vice versa; no seed at all means "far".
  bool inside = s.x >= 0.0 && distance(px, s.xy) < 0.5;
  vec2 other = inside ? s.zw : s.xy;
  float d = other.x >= 0.0 ? distance(px, other) : 1e4;
  o = vec4(d / uScale, 0.0, 0.0, 1.0);
}`;

/**
 * Prepended to each effect, which defines `vec4 effect(vec2 fp)` (fp = field position in CSS px, y down) returning
 * straight alpha. The helpers mirror gust's shader prelude but take CSS px where gust takes sprite UVs.
 */
export const EFFECT_PRELUDE = /* glsl */ `#version 300 es
precision highp float;
${BASE}
uniform sampler2D uDist;
uniform sampler2D uSeeds;
uniform float uScale;    // field texels per CSS px
uniform vec2 uField;     // field size, CSS px
uniform vec2 uOrigin;    // field top-left in the canvas, CSS px
uniform float uCanvasH;  // canvas height, CSS px
uniform float uDpr;
uniform float uTime;
out vec4 o;

float hash(vec2 q) {
  vec2 v = fract(q * vec2(123.34, 456.21));
  v += dot(v, v + 45.32);
  return fract(v.x * v.y);
}
float vnoise(vec2 q) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 q) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { v += amp * vnoise(q); q *= 2.03; amp *= 0.5; }
  return v;
}
// distance from px to the silhouette, inside or out, CSS px
float edge_dist(vec2 px) { return textureLod(uDist, px / uField, 0.0).r; }
// the nearest silhouette texel to px, CSS px; x < 0 when there is none
vec2 edge_seed(vec2 px) {
  ivec2 size = textureSize(uSeeds, 0);
  ivec2 t = clamp(ivec2(px * uScale), ivec2(0), size - 1);
  vec4 s = texelFetch(uSeeds, t, 0);
  // seeds hold texel centres (gl_FragCoord of the seed pass)
  bool inside = s.x >= 0.0 && distance(vec2(t) + 0.5, s.xy) < 0.5;
  vec2 other = inside ? s.zw : s.xy;
  return other.x >= 0.0 ? other / uScale : vec2(-1.0);
}
// fades over the outer w CSS px of the field so nothing clips at its border
float border_fade(vec2 fp, float w) {
  float d = min(min(fp.x, uField.x - fp.x), min(fp.y, uField.y - fp.y));
  return smoothstep(0.0, w, d);
}
vec3 fire_palette(float h0) {
  float h = clamp(h0, 0.0, 1.0);
  return vec3(pow(h, 0.9) * 1.9, pow(h, 1.8) * 1.45, pow(h, 4.5) * 1.1);
}
// composites colour c with coverage m over premultiplied body
vec4 over(vec4 body, vec3 c, float m) { return body * (1.0 - m) + vec4(c * m, m); }
// tonemaps the emissive light and lays it over the body; straight alpha out
vec4 finish(vec4 body, vec3 light) {
  vec3 lit = 1.0 - exp(-light * 1.8);
  float la = max(lit.r, max(lit.g, lit.b));
  float a = body.a + la * (1.0 - body.a);
  vec3 rgb = a > 0.0 ? min((body.rgb + lit) / max(a, 1e-6), vec3(1.0)) : vec3(0.0);
  return vec4(rgb, a);
}

vec4 effect(vec2 fp);

void main() {
  vec2 fp = vec2(gl_FragCoord.x / uDpr, uCanvasH - gl_FragCoord.y / uDpr) - uOrigin;
  if (fp.x < 0.0 || fp.y < 0.0 || fp.x > uField.x || fp.y > uField.y) { o = vec4(0.0); return; }
  vec4 c = effect(fp);
  o = vec4(c.rgb * c.a, c.a);
}
`;
