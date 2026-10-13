// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Page Transitions: two live pages (canvas children); Go blends the visible one into the other with the picked
// transition from the GameMaker transition prefab.
import {
  captureInto,
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
import { transitions, type Transition } from './generated';

// Lets the prefab's GLSL ES 1.0 shaders compile as GLSL ES 3.0 unchanged.
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
#define texture2D texture
#define gl_FragColor fragColor
in vec2 v_vTexcoord;
out vec4 fragColor;
`;
// v_vTexcoord (from VS) is y-up across the page rect (gl-transitions convention); the shaders flip y when sampling.
const BLIT = `${PRELUDE}
uniform sampler2D from_tex;
void main() { fragColor = texture(from_tex, vec2(v_vTexcoord.x, 1.0 - v_vTexcoord.y)); }`;

const canvas = $<HTMLCanvasElement>('view');
const pages = [$('page-a'), $('page-b')];
const pick = $<HTMLSelectElement>('pick');
const shuffle = $<HTMLInputElement>('shuffle');
const status = $('status');
const credit = $('credit');
const duration = rangeValue($('duration'), (v) => `${v.toFixed(1)}s`);

const gl = initGL(canvas);
const textures = pages.map(() => makeTexture(gl, gl.LINEAR));
const blit = makeProgram(gl, BLIT, VS);

for (const t of transitions) pick.add(new Option(t.label, t.id));
const showCredit = (): void => {
  const t = transitions[pick.selectedIndex]!;
  credit.textContent = `by ${t.author} · ${t.license}`;
};
pick.addEventListener('change', showCredit);
showCredit();

const programs = new Map<string, Program | Error>();
function programFor(t: Transition): Program | Error {
  if (!programs.has(t.id)) {
    const src = t.source.replace(/^\s*varying\s+vec2\s+v_vTexcoord\s*;/m, '');
    try {
      programs.set(t.id, makeProgram(gl, PRELUDE + src, VS));
    } catch (err) {
      programs.set(t.id, err as Error);
    }
  }
  return programs.get(t.id)!;
}

let current = 0; // index of the live page
let active: { t: Transition; prog: Program; from: number; to: number; start: number; seconds: number } | null = null;
let captured = 0; // bit per page
let pageRect = { x: 0, y: 0, w: 1, h: 1 };

function layout(): void {
  fitCanvas(canvas);
  const page = pages[0]!;
  const w = page.offsetWidth,
    h = page.offsetHeight;
  const top = $('bar').getBoundingClientRect().bottom;
  const x = Math.round((canvas.clientWidth - w) / 2);
  const y = Math.round(Math.max(top + 24, top + (canvas.clientHeight - top - h) / 2));
  pageRect = { x, y, w, h };
  pages.forEach((p, i) => {
    placeElement(canvas, p, x, y);
    p.inert = i !== current || active !== null;
  });
}

function go(): void {
  if (active) return;
  if (shuffle.checked) {
    pick.selectedIndex = Math.floor(Math.random() * transitions.length);
    showCredit();
  }
  const t = transitions[pick.selectedIndex]!;
  const prog = programFor(t);
  if (prog instanceof Error) {
    status.textContent = `${t.label} failed to compile: ${prog.message}`;
    return;
  }
  status.textContent = '';
  active = { t, prog, from: current, to: 1 - current, start: performance.now(), seconds: duration() };
  layout();
}

function setUniforms(p: Program, t: Transition): void {
  for (const { name, kind, value } of t.params) {
    const loc = p.u(name);
    if (!loc) continue;
    const v = Array.isArray(value) ? value : [value];
    if (kind === 'i' || kind === 'b') gl.uniform1i(loc, v[0]!);
    else if (kind === 'vec2') gl.uniform2fv(loc, v);
    else if (kind === 'vec3') gl.uniform3fv(loc, v);
    else if (kind === 'vec4') gl.uniform4fv(loc, v);
    else gl.uniform1f(loc, v[0]!);
  }
}

function frame(): void {
  requestAnimationFrame(frame);
  if (captured !== 0b11) return;
  const dpr = canvas.width / canvas.clientWidth;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Draw into the page rect only (GL's y is up).
  gl.viewport(
    Math.round(pageRect.x * dpr),
    Math.round(canvas.height - (pageRect.y + pageRect.h) * dpr),
    Math.round(pageRect.w * dpr),
    Math.round(pageRect.h * dpr),
  );

  let progress = 1;
  if (active) progress = Math.min(1, (performance.now() - active.start) / 1000 / active.seconds);
  if (active && progress < 1) {
    const { prog, t, from, to } = active;
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[from]!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[to]!);
    gl.uniform1i(prog.u('from_tex'), 0);
    gl.uniform1i(prog.u('to_tex'), 1);
    gl.uniform1f(prog.u('progress'), progress);
    gl.uniform1f(prog.u('ratio'), pageRect.w / pageRect.h);
    setUniforms(prog, t);
  } else {
    if (active) {
      current = active.to;
      active = null;
      layout();
    }
    gl.useProgram(blit.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[current]!);
    gl.uniform1i(blit.u('from_tex'), 0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

canvas.addEventListener('paint', (ev) => {
  const changed = (ev as Event & { changedElements?: Element[] }).changedElements;
  pages.forEach((p, i) => {
    if (changed && !changed.includes(p) && captured & (1 << i)) return;
    captureInto(gl, textures[i]!, p);
    captured |= 1 << i;
  });
});

$('go').addEventListener('click', go);
const step = (by: number): void => {
  pick.selectedIndex = (pick.selectedIndex + by + transitions.length) % transitions.length;
  showCredit();
};
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
window.addEventListener('keydown', (e) => {
  // Only when nothing is focused: a focused link, control or page element keeps its own keys.
  if (e.target !== document.body && e.target !== document.documentElement) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    go();
  }
});
window.addEventListener('resize', () => {
  layout();
  canvas.requestPaint!();
});

// ?check compiles every transition up front and logs failures.
if (new URLSearchParams(location.search).has('check')) {
  const failed = transitions.filter((t) => programFor(t) instanceof Error);
  console.log(`transitions: ${transitions.length - failed.length}/${transitions.length} compiled`);
  for (const t of failed) console.log(`FAILED ${t.id}: ${(programFor(t) as Error).message}`);
}

layout();
canvas.requestPaint!();
requestAnimationFrame(frame);
