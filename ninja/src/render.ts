// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/*
 * WebGL2 drawing for HTML Ninja. Everything works in canvas CSS px (y down); `uView` maps that to clip space.
 * The splatter is a persistent half-resolution RGBA16F layer: cuts and landing droplets stamp into it, it fades a
 * little every frame, and the background pass lays it over the wood.
 */
import { makeProgram, makeTexture, type Program } from '@kit/gl';
import type { Vert } from './geom';

const NOISE = /* glsl */ `
float hash(vec2 q) { vec2 v = fract(q * vec2(123.34, 456.21)); v += dot(v, v + 45.32); return fract(v.x * v.y); }
float vnoise(vec2 q) {
  vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}`;

const FULL_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y); // y down
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The wood (public/img/ninja-wood.jpg once loaded, procedural planks until then) with the splatter over it. */
const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uWood;
uniform sampler2D uSplat;
uniform float uHasWood;
uniform vec2 uView;     // CSS px
uniform vec2 uWoodSize; // image px
uniform vec2 uShake;
${NOISE}
vec3 planks(vec2 px) {
  float plank = floor(px.x / 150.0);
  float x = fract(px.x / 150.0);
  vec2 q = vec2(px.x * 0.02, px.y * 0.0025 + plank * 7.3);
  float grain = vnoise(q * vec2(6.0, 1.0)) * 0.6 + vnoise(q * vec2(25.0, 3.0)) * 0.4;
  vec3 c = mix(vec3(0.33, 0.18, 0.08), vec3(0.52, 0.30, 0.14), grain);
  c *= 0.82 + 0.18 * hash(vec2(plank, 3.0));
  c *= smoothstep(0.0, 0.025, x) * smoothstep(1.0, 0.975, x) * 0.6 + 0.4;
  // a few knife cuts
  for (int i = 0; i < 9; i++) {
    vec2 a = vec2(hash(vec2(float(i), 1.0)), hash(vec2(float(i), 2.0))) * uView;
    float ang = hash(vec2(float(i), 3.0)) * 3.14159;
    vec2 d = vec2(cos(ang), sin(ang));
    vec2 r = px - a;
    float along = dot(r, d), across = dot(r, vec2(-d.y, d.x));
    float len = 80.0 + 160.0 * hash(vec2(float(i), 4.0));
    float cut = (1.0 - smoothstep(0.0, 1.6, abs(across))) * step(abs(along), len) * (1.0 - abs(along) / len);
    c *= 1.0 - 0.6 * cut;
  }
  return c;
}
void main() {
  vec2 px = vUv * uView + uShake;
  vec3 c;
  if (uHasWood > 0.5) {
    // cover-fit the image
    float s = max(uView.x / uWoodSize.x, uView.y / uWoodSize.y);
    vec2 uv = (px - 0.5 * uView) / (uWoodSize * s) + 0.5;
    c = texture(uWood, uv).rgb;
  } else {
    c = planks(px);
  }
  vec4 sp = texture(uSplat, vec2(vUv.x, 1.0 - vUv.y)); // premultiplied; rendered with GL's y up
  c = c * (1.0 - sp.a) + sp.rgb * (0.75 + 0.25 * c * 2.0);
  // vignette
  vec2 v = vUv - 0.5;
  c *= 1.0 - 0.45 * dot(v, v) * 2.0;
  o = vec4(c, 1.0);
}`;

/** A textured convex polygon (or its shadow) at a position, angle and scale. */
const POLY_VS = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec2 uView;
uniform vec2 uAt;
uniform float uAngle;
uniform float uScale;
out vec2 vUv;
void main() {
  float c = cos(uAngle), s = sin(uAngle);
  vec2 p = uAt + mat2(c, s, -s, c) * aPos * uScale;
  vUv = aUv;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
const POLY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uShadow; // 1: draw the silhouette as a soft dark shadow
void main() {
  vec4 t = texture(uTex, vUv);
  o = uShadow > 0.5 ? vec4(0.0, 0.0, 0.0, t.a * 0.35 * uAlpha) : vec4(t.rgb * uAlpha, t.a * uAlpha);
}`;

/** The blade: a strip with `across` -1..1 and `life` 0 (tail) .. 1 (tip). */
const TRAIL_VS = `#version 300 es
in vec2 aPos;
in vec2 aInfo; // across, life
uniform vec2 uView;
out vec2 vInfo;
void main() {
  vInfo = aInfo;
  gl_Position = vec4(aPos / uView * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
const TRAIL_FS = `#version 300 es
precision highp float;
in vec2 vInfo;
out vec4 o;
void main() {
  float x = abs(vInfo.x);
  float core = 1.0 - smoothstep(0.15, 0.45, x);
  float glow = 1.0 - smoothstep(0.3, 1.0, x);
  vec3 c = mix(vec3(0.45, 0.75, 1.0), vec3(1.0), core);
  float a = max(core, glow * 0.55) * vInfo.y;
  o = vec4(c * a, a);
}`;

/** Juice droplets and sparks: round points. */
const POINT_VS = `#version 300 es
in vec2 aPos;
in float aSize;
in vec4 aColor; // straight alpha
uniform vec2 uView;
uniform float uDpr;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = aSize * uDpr;
  gl_Position = vec4(aPos / uView * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
const POINT_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = smoothstep(1.0, 0.7, length(q)) * vColor.a;
  vec3 c = vColor.rgb * (1.0 + 0.5 * smoothstep(0.6, 0.0, length(q + vec2(0.3)))); // a glint
  o = vec4(c * a, a);
}`;

/** One splat stamped into the splatter layer: a streak along `uDir` with scattered drops. */
const SPLAT_VS = `#version 300 es
uniform vec2 uView;
uniform vec2 uCenter;
uniform vec2 uDir;    // unit
uniform vec2 uSize;   // half length, half width (CSS px)
out vec2 vQ;
void main() {
  vec2 corners[6] = vec2[](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));
  vec2 q = corners[gl_VertexID];
  vQ = q;
  vec2 n = vec2(-uDir.y, uDir.x);
  vec2 p = uCenter + uDir * q.x * uSize.x + n * q.y * uSize.y;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vQ;
out vec4 o;
uniform vec3 uColor;
uniform float uSeed;
uniform float uStreak; // 0: a round drop splat, 1: a slash streak
${NOISE}
void main() {
  vec2 q = vQ;
  float a = 0.0;
  if (uStreak > 0.5) {
    // the main smear, ragged and tapering to both ends
    float halfw = (1.0 - q.x * q.x) * (0.18 + 0.4 * vnoise(vec2(q.x * 5.0 + uSeed, uSeed)));
    a = smoothstep(halfw, halfw - 0.06, abs(q.y));
    // thin parallel runs
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float off = hash(vec2(uSeed, fk)) * 1.4 - 0.7;
      float lw = 0.025 + 0.04 * hash(vec2(fk, uSeed));
      float len = 0.4 + 0.6 * hash(vec2(uSeed + fk, 9.0));
      float run = smoothstep(lw, lw * 0.4, abs(q.y - off)) * step(abs(q.x), len) * (1.0 - abs(q.x) / len);
      a = max(a, run);
    }
  } else {
    float r = length(q);
    float edge = 0.55 + 0.3 * vnoise(vec2(atan(q.y, q.x) * 3.0 + uSeed, uSeed));
    a = smoothstep(edge, edge - 0.08, r);
  }
  // scattered drops
  vec2 g = q * 5.0;
  vec2 cell = floor(g), f = fract(g) - 0.5;
  float h = hash(cell + uSeed);
  vec2 jitter = vec2(hash(cell + uSeed + 3.1), hash(cell + uSeed + 7.7)) - 0.5;
  float drop = step(0.72, h) * smoothstep(0.2 * h, 0.14 * h, length(f - jitter * 0.4)) * (1.0 - smoothstep(0.6, 1.0, length(q)));
  a = max(a, drop) * 0.88;
  o = vec4(uColor * a, a);
}`;

/**
 * The fire trail's feedback step: last frame's trail risen, wobbled, blurred, cooled and faded. GL orientation (y up),
 * so rising samples from below.
 */
const FIRE_ADVECT_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uPrev;
uniform float uKeep;   // alpha kept this frame
uniform float uRise;   // uv per frame
uniform float uTime;
uniform vec3 uCool;    // per-frame colour falloff: yellow cools to red, then dark
${NOISE}
void main() {
  vec2 size = vec2(textureSize(uPrev, 0));
  vec2 uv = gl_FragCoord.xy / size;
  float n = vnoise(uv * vec2(9.0, 5.0) + vec2(0.0, uTime * 1.5)) - 0.5;
  vec2 src = uv - vec2(n * 0.004, uRise);
  vec2 t = 1.0 / size;
  vec4 c = texture(uPrev, src) * 0.4
    + (texture(uPrev, src + vec2(t.x, 0.0)) + texture(uPrev, src - vec2(t.x, 0.0))
     + texture(uPrev, src + vec2(0.0, t.y)) + texture(uPrev, src - vec2(0.0, t.y))) * 0.15;
  c.rgb *= uCool;
  o = c * uKeep;
}`;

/** A texture drawn over the whole target (premultiplied), sampled GL way up. */
const OVERLAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main() { o = texture(uTex, vec2(vUv.x, 1.0 - vUv.y)); }`;

const FLASH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uAlpha;
void main() { o = vec4(vec3(uAlpha), uAlpha); }`;

export interface Splat {
  x: number;
  y: number;
  dx: number;
  dy: number;
  len: number;
  wid: number;
  color: [number, number, number];
  streak: boolean;
}
export interface Point {
  x: number;
  y: number;
  size: number;
  color: [number, number, number, number];
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly P: Record<'bg' | 'poly' | 'trail' | 'point' | 'splat' | 'flash' | 'advect' | 'overlay', Program>;
  private readonly fbo: WebGLFramebuffer | null;
  private readonly polyBuf: WebGLBuffer;
  private readonly polyVao: WebGLVertexArrayObject;
  private readonly trailBuf: WebGLBuffer;
  private readonly trailVao: WebGLVertexArrayObject;
  private readonly pointBuf: WebGLBuffer;
  private readonly pointVao: WebGLVertexArrayObject;
  private readonly emptyVao: WebGLVertexArrayObject;
  private splat = { tex: null as WebGLTexture | null, w: 0, h: 0 };
  /** The fire trail: half-resolution RGBA16F ping-pong, [0] holds the current trail. */
  private fire = { tex: [] as WebGLTexture[], w: 0, h: 0 };
  private wood = { tex: null as WebGLTexture | null, w: 1, h: 1 };
  view = { w: 1, h: 1, dpr: 1 };

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const mk = (fs: string, vs: string = FULL_VS) => makeProgram(gl, fs, vs);
    this.P = {
      bg: mk(BG_FS),
      poly: mk(POLY_FS, POLY_VS),
      trail: mk(TRAIL_FS, TRAIL_VS),
      point: mk(POINT_FS, POINT_VS),
      splat: mk(SPLAT_FS, SPLAT_VS),
      flash: mk(FLASH_FS),
      advect: mk(FIRE_ADVECT_FS),
      overlay: mk(OVERLAY_FS),
    };
    this.fbo = gl.createFramebuffer();
    this.emptyVao = gl.createVertexArray()!;

    const vao = (prog: Program, attrs: [string, number][]): [WebGLVertexArrayObject, WebGLBuffer] => {
      const v = gl.createVertexArray()!;
      const b = gl.createBuffer()!;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      const stride = attrs.reduce((s, [, n]) => s + n, 0) * 4;
      let off = 0;
      for (const [name, n] of attrs) {
        const loc = gl.getAttribLocation(prog.prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
        off += n * 4;
      }
      gl.bindVertexArray(null);
      return [v, b];
    };
    [this.polyVao, this.polyBuf] = vao(this.P.poly, [
      ['aPos', 2],
      ['aUv', 2],
    ]);
    [this.trailVao, this.trailBuf] = vao(this.P.trail, [
      ['aPos', 2],
      ['aInfo', 2],
    ]);
    [this.pointVao, this.pointBuf] = vao(this.P.point, [
      ['aPos', 2],
      ['aSize', 1],
      ['aColor', 4],
    ]);

    const img = new Image();
    img.onload = () => {
      const t = makeTexture(gl, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.wood = { tex: t, w: img.naturalWidth, h: img.naturalHeight };
    };
    img.src = `${import.meta.env.BASE_URL}img/ninja-wood.jpg`;
  }

  resize(w: number, h: number, dpr: number): void {
    this.view = { w, h, dpr };
    const sw = Math.max(1, Math.round((w * dpr) / 2)),
      sh = Math.max(1, Math.round((h * dpr) / 2));
    if (this.splat.w === sw && this.splat.h === sh) return;
    const gl = this.gl;
    this.splat.tex ??= makeTexture(gl, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, this.splat.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sw, sh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    this.splat.w = sw;
    this.splat.h = sh;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.splat.tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.fire.tex.length) this.fire.tex = [makeTexture(gl, gl.LINEAR), makeTexture(gl, gl.LINEAR)];
    for (const t of this.fire.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sw, sh, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.fire.w = sw;
    this.fire.h = sh;
  }

  /**
   * Steps the fire trail by `dt`: the trail rises, wobbles, cools and fades, then each stamp (a flames-only fire
   * texture on a polygon at a position, like poly()) is laid into it where its bomb is now.
   */
  updateFireTrail(
    dt: number,
    time: number,
    stamps: { tex: WebGLTexture; verts: Vert[]; x: number; y: number }[],
  ): void {
    const gl = this.gl;
    const [cur, next] = this.fire.tex as [WebGLTexture, WebGLTexture];
    gl.bindVertexArray(this.emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, next, 0);
    gl.viewport(0, 0, this.fire.w, this.fire.h);
    gl.disable(gl.BLEND);
    const p = this.P.advect;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur);
    gl.uniform1i(p.u('uPrev'), 0);
    const f = dt * 60; // per-60th-of-a-second rates, so the trail looks the same at any frame rate
    gl.uniform1f(p.u('uKeep'), Math.pow(0.95, f));
    gl.uniform1f(p.u('uRise'), (110 * dt) / this.view.h);
    gl.uniform1f(p.u('uTime'), time);
    gl.uniform3f(p.u('uCool'), 1, Math.pow(0.97, f), Math.pow(0.9, f));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const s of stamps) this.drawPoly(s.tex, s.verts, s.x, s.y, 0, 1, 1, false);
    this.fire.tex = [next, cur];
  }

  /** Lays the fire trail over what has been drawn so far. */
  fireTrail(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    const p = this.P.overlay;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fire.tex[0]!);
    gl.uniform1i(p.u('uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Fades the splatter by `keep` (0..1) and stamps new splats into it. */
  updateSplatter(keep: number, splats: Splat[]): void {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.splat.tex, 0);
    gl.viewport(0, 0, this.splat.w, this.splat.h);
    gl.enable(gl.BLEND);
    // dest *= keep
    gl.useProgram(this.P.flash.prog);
    gl.uniform1f(this.P.flash.u('uAlpha'), 0);
    gl.blendColor(0, 0, 0, keep);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // stamps, premultiplied over
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.P.splat;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u('uView'), this.view.w, this.view.h);
    for (const s of splats) {
      gl.uniform2f(p.u('uCenter'), s.x, s.y);
      gl.uniform2f(p.u('uDir'), s.dx, s.dy);
      gl.uniform2f(p.u('uSize'), s.len, s.wid);
      gl.uniform3f(p.u('uColor'), ...s.color);
      gl.uniform1f(p.u('uSeed'), Math.random() * 100);
      gl.uniform1f(p.u('uStreak'), s.streak ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  begin(shake: { x: number; y: number }): void {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, Math.round(this.view.w * this.view.dpr), Math.round(this.view.h * this.view.dpr));
    gl.disable(gl.BLEND);
    const p = this.P.bg;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.wood.tex);
    gl.uniform1i(p.u('uWood'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.splat.tex);
    gl.uniform1i(p.u('uSplat'), 1);
    gl.uniform1f(p.u('uHasWood'), this.wood.tex ? 1 : 0);
    gl.uniform2f(p.u('uView'), this.view.w, this.view.h);
    gl.uniform2f(p.u('uWoodSize'), this.wood.w, this.wood.h);
    gl.uniform2f(p.u('uShake'), -shake.x, -shake.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** A textured polygon (local CSS px around its centre) at (x, y). */
  poly(
    tex: WebGLTexture,
    verts: Vert[],
    x: number,
    y: number,
    angle: number,
    scale: number,
    alpha: number,
    shadow: boolean,
  ): void {
    this.drawPoly(tex, verts, x, y, angle, scale, alpha, shadow);
  }

  /** poly() into whatever framebuffer and viewport are bound. */
  private drawPoly(
    tex: WebGLTexture,
    verts: Vert[],
    x: number,
    y: number,
    angle: number,
    scale: number,
    alpha: number,
    shadow: boolean,
  ): void {
    const gl = this.gl;
    const data = new Float32Array(verts.flatMap((v) => [v.x, v.y, v.u, v.v]));
    gl.bindVertexArray(this.polyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    const p = this.P.poly;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u('uTex'), 0);
    gl.uniform2f(p.u('uView'), this.view.w, this.view.h);
    gl.uniform2f(p.u('uAt'), x, y);
    gl.uniform1f(p.u('uAngle'), angle);
    gl.uniform1f(p.u('uScale'), scale);
    gl.uniform1f(p.u('uAlpha'), alpha);
    gl.uniform1f(p.u('uShadow'), shadow ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, verts.length);
  }

  points(pts: Point[]): void {
    if (!pts.length) return;
    const gl = this.gl;
    const data = new Float32Array(pts.flatMap((p) => [p.x, p.y, p.size, ...p.color]));
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    const p = this.P.point;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u('uView'), this.view.w, this.view.h);
    gl.uniform1f(p.u('uDpr'), this.view.dpr);
    gl.drawArrays(gl.POINTS, 0, pts.length);
  }

  /** The blade ribbon through `pts` (oldest first), `life` 0..1 per point. */
  trail(pts: { x: number; y: number; life: number }[], width: number): void {
    if (pts.length < 2) return;
    const gl = this.gl;
    const data: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]!,
        b = pts[Math.min(pts.length - 1, i + 1)]!,
        p = pts[i]!;
      let dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = width * p.life * (0.35 + 0.65 * (i / (pts.length - 1)));
      data.push(p.x - dy * w, p.y + dx * w, -1, p.life, p.x + dy * w, p.y - dx * w, 1, p.life);
    }
    gl.bindVertexArray(this.trailVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
    const p = this.P.trail;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u('uView'), this.view.w, this.view.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, pts.length * 2);
  }

  flash(alpha: number): void {
    if (alpha <= 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.useProgram(this.P.flash.prog);
    gl.uniform1f(this.P.flash.u('uAlpha'), alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
