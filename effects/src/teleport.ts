// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Teleport: port of gust's shd_teleport (a glowing noise front shedding motes). Gust loops it on a timer; here the
// phase follows the switch.
import { $ } from '@kit/dom';
import { belowControls, colourValue, createStage, rangeValue, switchPhase } from '@kit/stage';

const EFFECT = /* glsl */ `
uniform float uPhase;  // 0 = fully here, 1 = gone (gust's u)
uniform float uCycle;  // changes the noise pattern per trip (gust's ci)
uniform float uGrain;
uniform float uEdge;
uniform float uSweep;
uniform float uMotes;
uniform vec3 uColour;

const float R = 500.0; // CSS px per gust UV unit

float dist_r(vec2 r) { return edge_dist(r * R) / R; }

vec4 effect(vec2 fp) {
  vec2 uv = fp / R;
  vec2 ev = (fp - uElem.xy) / uElem.zw; // 0..1 across the panel, for the sweep
  float t = uTime;
  vec4 sp = base(fp);
  float inside = smoothstep(0.45, 0.55, sp.a);
  float outside = 1.0 - inside;
  float d_here = dist_r(uv);
  vec4 body = vec4(0.0);
  vec3 light = vec3(0.0);

  float u = uPhase;
  float ci = uCycle;
  float prog = smoothstep(0.05, 0.7, u);
  float vis = 1.0 - smoothstep(0.7, 0.97, u);

  float n = clamp((fbm(uv * uGrain + ci * 7.1) - 0.2) / 0.6, 0.0, 1.0);
  // Clamped to 0.02..1 with the cut starting and ending beyond it: unlike gust's sprites the panel reaches the
  // texture's edge, which would otherwise glint at rest.
  float field = clamp(mix(n, 1.0 - ev.y + (n - 0.5) * 0.25, uSweep), 0.02, 1.0);
  float cut = prog * (1.0 + uEdge + 0.04) - uEdge - 0.02;
  float keep = smoothstep(cut, cut + 0.015, field);
  float band = keep * (1.0 - smoothstep(0.0, uEdge, field - cut));

  // motes: each edge cell sheds one that floats out along the edge's normal
  vec2 seed = edge_seed(fp) / R;
  float cells = 48.0;
  vec2 cid = floor(seed * cells);
  vec2 home = (cid + 0.5) / cells;
  vec2 e = vec2(0.5 / cells, 0.0);
  vec2 grad = vec2(dist_r(home + e.xy) - dist_r(home - e.xy), dist_r(home + e.yx) - dist_r(home - e.yx));
  vec2 normal = base(home * R).a > 0.5 ? -grad : grad;
  vec2 away = length(normal) > 1e-4 ? normalize(normal) : normalize(uv - seed + 1e-6);
  away = normalize(away + vec2(0.0, -0.4));
  float h = hash(cid + ci * 0.53);
  float h2 = hash(cid * 1.7 + ci);
  float show = step(1.0 - uMotes, h2) * step(0.0, seed.x);
  float reach = prog * 0.22 * (0.4 + 0.6 * h);
  vec2 wobble = vec2(sin(t * 3.0 + h * 9.0), cos(t * 2.3 + h * 5.0)) * 0.006;
  vec2 jitter = (vec2(h2, h) - 0.5) * 0.7 / cells;
  vec2 centre = home + jitter + away * reach + wobble;
  vec2 q = uv - centre;
  float size = 0.006 * (0.6 + 0.8 * h);
  float twinkle = 0.6 + 0.4 * sin(t * 12.0 + h * 40.0);
  float mote = show * exp(-dot(q, q) / (size * size)) * twinkle * prog * outside;

  float beam = pow(vnoise(vec2(uv.x * 120.0, uv.y * 6.0 + t * 25.0)), 5.0);

  body = over(body, sp.rgb, sp.a * keep);
  light += uColour * band * inside * 2.0;
  light += uColour * (0.2 + 0.7 * beam) * (1.0 - keep) * inside;
  light += uColour * inside * keep * prog * 0.15;
  light += uColour * mote * 2.5;
  light += uColour * exp(-d_here / 0.05) * outside * prog * 0.35;

  vec4 c = finish(body, light);
  c.a *= border_fade(fp, 30.0) * vis;
  return c;
}`;

const panel = $<HTMLElement>('panel');
const toggle = $<HTMLButtonElement>('toggle');
const colour = colourValue($('colour'), { accent: true });
const speed = rangeValue($('speed'), (v) => `${v.toFixed(1)}s`);
const grain = rangeValue($('grain'));
const sweep = rangeValue($('sweep'), (v) => `${v}%`);
const motes = rangeValue($('motes'), (v) => `${v}%`);
const edge = rangeValue($('edge'));

const trip = switchPhase(toggle, panel, speed);

createStage({
  canvas: $('view'),
  panel,
  margin: { top: 130, right: 130, bottom: 130, left: 130 },
  place: belowControls($('controls')),
  effect: EFFECT,
  uniforms: (gl, u) => {
    trip.tick();
    gl.uniform1f(u('uPhase'), trip.state.phase);
    gl.uniform1f(u('uCycle'), trip.state.cycle);
    gl.uniform1f(u('uGrain'), grain());
    gl.uniform1f(u('uEdge'), edge() / 100);
    gl.uniform1f(u('uSweep'), sweep() / 100);
    gl.uniform1f(u('uMotes'), motes() / 100);
    gl.uniform3f(u('uColour'), ...colour());
  },
});
