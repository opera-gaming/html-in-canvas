// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Post-Processing: a live page run through GLSL ES 3.0 ports of the GameMaker post-process prefab's shaders.
// Intermediate textures keep the page's orientation (row 0 = top); only the last pass, to the canvas, flips.
import {
  captureInto,
  drawTo,
  fitCanvas,
  initGL,
  makeProgram,
  makeTexture,
  placeElement,
  rangeValue,
  type Program,
} from '@kit/gl';
import { $ } from '@kit/dom';
import { FULLSCREEN_UV_VS as VS } from '@kit/shaders';

const fs = (body: string): string => `#version 300 es
precision highp float;
in vec2 v_vTexcoord;
out vec4 fragColor;
uniform sampler2D source;
uniform float flipY; // 1 for the pass that draws to the canvas
vec2 coord() { return vec2(v_vTexcoord.x, mix(v_vTexcoord.y, 1.0 - v_vTexcoord.y, flipY)); }
${body}`;

const PASSTHROUGH = fs(`void main() { fragColor = texture(source, coord()); }`);
const MOTION_BLUR = fs(`
uniform sampler2D accum;
uniform float blend_factor;
void main() { fragColor = mix(texture(source, coord()), texture(accum, coord()), blend_factor); }`);
const BLOOM_THRESHOLD = fs(`
uniform float threshold;
void main() {
  vec3 color = texture(source, coord()).rgb;
  float brightness = max(max(color.r, color.g), color.b);
  fragColor = vec4(brightness > threshold ? color : vec3(0.0), 1.0);
}`);
const BLOOM_BLUR = fs(`
uniform vec2 direction;
uniform float resolution;
void main() {
  vec2 uv = coord();
  vec2 o = direction / resolution;
  vec3 sum = texture(source, uv + o * -4.0).rgb * 0.0162
    + texture(source, uv + o * -3.0).rgb * 0.0541
    + texture(source, uv + o * -2.0).rgb * 0.1216
    + texture(source, uv + o * -1.0).rgb * 0.1946
    + texture(source, uv).rgb * 0.2270
    + texture(source, uv + o * 1.0).rgb * 0.1946
    + texture(source, uv + o * 2.0).rgb * 0.1216
    + texture(source, uv + o * 3.0).rgb * 0.0541
    + texture(source, uv + o * 4.0).rgb * 0.0162;
  fragColor = vec4(sum, 1.0);
}`);
const BLOOM_COMBINE = fs(`
uniform sampler2D one;
uniform float intensity;
void main() {
  vec2 uv = coord();
  fragColor = vec4(texture(source, uv).rgb + texture(one, uv).rgb * intensity, texture(source, uv).a);
}`);
const SCREEN_FRINGE = fs(`
uniform float intensity;
uniform float saturation;
void main() {
  vec2 p = coord();
  vec2 delta = p - vec2(0.5);
  vec2 dir = delta * intensity * length(delta);
  vec3 shifted = vec3(texture(source, p + dir).r, texture(source, p).g, texture(source, p - dir).b);
  vec4 original = texture(source, p);
  fragColor = vec4(mix(original.rgb, shifted, saturation), original.a);
}`);
const VIGNETTE = fs(`
uniform float intensity;
uniform float start;
uniform float stop;
void main() {
  vec2 p = coord();
  float v = smoothstep(start, stop, distance(p, vec2(0.5)));
  vec4 c = texture(source, p);
  fragColor = vec4(c.rgb * mix(1.0, 1.0 - intensity, v), c.a);
}`);

const canvas = $<HTMLCanvasElement>('view');
const page = $('page');
const on = (id: string): (() => boolean) => {
  const el = $<HTMLInputElement>(`on-${id}`);
  return () => el.checked;
};
const num = (id: string, digits = 2): (() => number) => rangeValue($(id), (v) => v.toFixed(digits));
const fx = {
  motion: { on: on('motion'), blend: num('motion-blend') },
  bloom: {
    on: on('bloom'),
    threshold: num('bloom-threshold'),
    intensity: num('bloom-intensity'),
    scale: rangeValue($('bloom-scale'), (v) => `1/${2 ** v}`),
  },
  fringe: { on: on('fringe'), intensity: num('fringe-intensity', 3), saturation: num('fringe-saturation') },
  vignette: {
    on: on('vignette'),
    intensity: num('vignette-intensity'),
    start: num('vignette-start'),
    stop: num('vignette-stop'),
  },
};

// The comet and ring run on a clock advanced by speed × dt, so changing the speed changes only the rate, not position.
const speed = (): number => Number($<HTMLInputElement>('speed').value);
let paused = false;
$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? 'PLAY' : 'PAUSE';
});
$<HTMLInputElement>('grid').addEventListener('change', (e) =>
  page.classList.toggle('nogrid', !(e.target as HTMLInputElement).checked),
);
const comet = page.querySelector<HTMLElement>('.comet')!;
const ring = page.querySelector<HTMLElement>('.ring')!;
const track = page.querySelector<HTMLElement>('.track')!;
let clock = 0; // seconds of animation at speed 1
let score = 128450;
let lastTick = performance.now();
function animatePage(): void {
  const now = performance.now();
  if (!paused) clock += ((now - lastTick) / 1000) * speed();
  lastTick = now;
  const leg = (clock / 1.6) % 2;
  const t = leg < 1 ? leg : 2 - leg;
  const eased = t * t * (3 - 2 * t);
  comet.style.transform = `translateX(${(eased * (track.clientWidth - 80)).toFixed(1)}px)`;
  ring.style.transform = `rotate(${((clock / 1.6) * 360) % 360}deg)`;
  const shown = Math.floor(128450 + clock * 300);
  if (shown !== score) {
    score = shown;
    $('score').textContent = score.toLocaleString('en').replace(/,/g, ' ');
  }
}

const gl = initGL(canvas);
const P = {
  pass: makeProgram(gl, PASSTHROUGH, VS),
  motion: makeProgram(gl, MOTION_BLUR, VS),
  threshold: makeProgram(gl, BLOOM_THRESHOLD, VS),
  blur: makeProgram(gl, BLOOM_BLUR, VS),
  combine: makeProgram(gl, BLOOM_COMBINE, VS),
  fringe: makeProgram(gl, SCREEN_FRINGE, VS),
  vignette: makeProgram(gl, VIGNETTE, VS),
};
const fbo = gl.createFramebuffer();
const source = makeTexture(gl, gl.LINEAR);
type Target = { tex: WebGLTexture; w: number; h: number };
const target = (): Target => ({ tex: makeTexture(gl, gl.LINEAR), w: 0, h: 0 });
const chain = [target(), target()]; // ping-pong between effects
const accum = [target(), target()]; // motion blur read/write
const small = [target(), target()]; // bloom
let accumValid = false;

function size(t: Target, w: number, h: number): void {
  if (t.w === w && t.h === h) return;
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  t.w = w;
  t.h = h;
}

let rect = { x: 0, y: 0, w: 1, h: 1 };
function layout(): void {
  fitCanvas(canvas);
  const panel = $('fx').getBoundingClientRect().width;
  const w = page.offsetWidth,
    h = page.offsetHeight;
  const x = Math.round(Math.max(16, (canvas.clientWidth - panel - w) / 2));
  const y = Math.round(Math.max(16, (canvas.clientHeight - h) / 2));
  rect = { x, y, w, h };
  placeElement(canvas, page, x, y);
  accumValid = false;
}

/** Runs `prog` reading `inputs` (sampler name → texture) into `out` (null = the page rect on the canvas). */
function pass(
  prog: Program,
  inputs: Record<string, WebGLTexture>,
  out: Target | null,
  set?: (p: Program) => void,
): void {
  gl.useProgram(prog.prog);
  Object.entries(inputs).forEach(([name, tex], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u(name), unit);
  });
  gl.uniform1f(prog.u('flipY'), out ? 0 : 1);
  set?.(prog);
  if (out) {
    drawTo(gl, fbo, out.tex, out.w, out.h);
    return;
  }
  const dpr = canvas.width / canvas.clientWidth;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(
    Math.round(rect.x * dpr),
    Math.round(canvas.height - (rect.y + rect.h) * dpr),
    Math.round(rect.w * dpr),
    Math.round(rect.h * dpr),
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

let captured = false;
function frame(): void {
  requestAnimationFrame(frame);
  animatePage();
  if (!captured) return;
  const dpr = canvas.width / canvas.clientWidth;
  const w = Math.round(rect.w * dpr),
    h = Math.round(rect.h * dpr);
  for (const t of [...chain, ...accum]) size(t, w, h);

  // Each enabled effect reads `src` and writes the next chain target; the last one draws to the canvas.
  const steps: ((src: WebGLTexture, out: Target | null) => void)[] = [];
  if (fx.motion.on()) {
    steps.push((src, out) => {
      if (!accumValid) {
        pass(P.pass, { source: src }, accum[0]!);
        accumValid = true;
      }
      pass(P.motion, { source: src, accum: accum[0]!.tex }, accum[1]!, (p) =>
        gl.uniform1f(p.u('blend_factor'), fx.motion.blend()),
      );
      accum.reverse();
      pass(P.pass, { source: accum[0]!.tex }, out);
    });
  } else accumValid = false;
  if (fx.bloom.on()) {
    steps.push((src, out) => {
      const div = 2 ** fx.bloom.scale();
      const sw = Math.max(1, Math.round(w / div)),
        sh = Math.max(1, Math.round(h / div));
      for (const t of small) size(t, sw, sh);
      pass(P.threshold, { source: src }, small[0]!, (p) => gl.uniform1f(p.u('threshold'), fx.bloom.threshold()));
      pass(P.blur, { source: small[0]!.tex }, small[1]!, (p) => {
        gl.uniform2f(p.u('direction'), 1, 0);
        gl.uniform1f(p.u('resolution'), sw);
      });
      pass(P.blur, { source: small[1]!.tex }, small[0]!, (p) => {
        gl.uniform2f(p.u('direction'), 0, 1);
        gl.uniform1f(p.u('resolution'), sh);
      });
      pass(P.combine, { source: src, one: small[0]!.tex }, out, (p) =>
        gl.uniform1f(p.u('intensity'), fx.bloom.intensity()),
      );
    });
  }
  if (fx.fringe.on()) {
    steps.push((src, out) =>
      pass(P.fringe, { source: src }, out, (p) => {
        gl.uniform1f(p.u('intensity'), fx.fringe.intensity());
        gl.uniform1f(p.u('saturation'), fx.fringe.saturation());
      }),
    );
  }
  if (fx.vignette.on()) {
    steps.push((src, out) =>
      pass(P.vignette, { source: src }, out, (p) => {
        gl.uniform1f(p.u('intensity'), fx.vignette.intensity());
        gl.uniform1f(p.u('start'), fx.vignette.start());
        gl.uniform1f(p.u('stop'), fx.vignette.stop());
      }),
    );
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!steps.length) {
    pass(P.pass, { source }, null);
    return;
  }
  let src: WebGLTexture = source;
  steps.forEach((step, i) => {
    const last = i === steps.length - 1;
    const out = last ? null : chain[i % 2]!;
    step(src, out);
    if (out) src = out.tex;
  });
}

canvas.addEventListener('paint', () => {
  captureInto(gl, source, page);
  captured = true;
});
window.addEventListener('resize', () => {
  layout();
  canvas.requestPaint!();
});

layout();
canvas.requestPaint!();
requestAnimationFrame(frame);
