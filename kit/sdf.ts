// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// A jump flood turns a captured element's alpha into a distance field and a nearest-edge texture; an effect shader
// (see EFFECT_PRELUDE) then runs over the "field": the element plus a margin.
import { DIST_FS, EFFECT_PRELUDE, JFA_FS, SEED_FS } from './shaders';
import { drawTo, makeProgram, makeTexture, type Program } from './gl';

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type SetUniforms = (gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null) => void;

/** Largest jump-flood texture side. */
const MAX_FIELD_TEX = 1024;

export class SdfEffect {
  /** Field size in CSS px, and its flood texture size (scale = texels per CSS px). */
  field = { w: 1, h: 1, scale: 1, texW: 0, texH: 0 };
  /** The element's rect inside the field, CSS px. */
  elem = { x: 0, y: 0, w: 1, h: 1 };
  private readonly seedP: Program;
  private readonly jfaP: Program;
  private readonly distP: Program;
  private readonly fxP: Program;
  private readonly seeds: WebGLTexture[];
  private seedOut = 0;
  private readonly distTex: WebGLTexture;
  private readonly fbo: WebGLFramebuffer | null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    effect: string,
  ) {
    this.seedP = makeProgram(gl, SEED_FS);
    this.jfaP = makeProgram(gl, JFA_FS);
    this.distP = makeProgram(gl, DIST_FS);
    this.fxP = makeProgram(gl, EFFECT_PRELUDE + effect);
    this.seeds = [makeTexture(gl, gl.NEAREST), makeTexture(gl, gl.NEAREST)];
    this.distTex = makeTexture(gl, gl.LINEAR);
    this.fbo = gl.createFramebuffer();
  }

  /** Sizes the field for a w × h element with `margin` around it. */
  resize(w: number, h: number, margin: Margin): void {
    const gl = this.gl;
    const fw = w + margin.left + margin.right,
      fh = h + margin.top + margin.bottom;
    const scale = Math.min(1, MAX_FIELD_TEX / Math.max(fw, fh));
    const texW = Math.max(1, Math.round(fw * scale)),
      texH = Math.max(1, Math.round(fh * scale));
    if (texW !== this.field.texW || texH !== this.field.texH) {
      for (const t of this.seeds) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, texW, texH, 0, gl.RGBA, gl.HALF_FLOAT, null);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.distTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, texW, texH, 0, gl.RED, gl.HALF_FLOAT, null);
    }
    this.field = { w: fw, h: fh, scale, texW, texH };
    this.elem = { x: margin.left, y: margin.top, w, h };
  }

  /** Rebuilds the jump flood and distance field from `base`, the element's capture. */
  build(base: WebGLTexture): void {
    const gl = this.gl;
    const { field, elem } = this;
    const pass = (target: WebGLTexture): void => drawTo(gl, this.fbo, target, field.texW, field.texH);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);

    gl.useProgram(this.seedP.prog);
    gl.bindTexture(gl.TEXTURE_2D, base);
    gl.uniform1i(this.seedP.u('uBase'), 0);
    gl.uniform4f(this.seedP.u('uElem'), elem.x, elem.y, elem.w, elem.h);
    gl.uniform1f(this.seedP.u('uScale'), field.scale);
    pass(this.seeds[0]!);

    gl.useProgram(this.jfaP.prog);
    gl.uniform1i(this.jfaP.u('uPrev'), 0);
    let src = 0;
    for (let step = 2 ** Math.floor(Math.log2(Math.max(field.texW, field.texH))); step >= 1; step /= 2) {
      gl.bindTexture(gl.TEXTURE_2D, this.seeds[src]!);
      gl.uniform1f(this.jfaP.u('uStep'), step);
      pass(this.seeds[1 - src]!);
      src = 1 - src;
    }
    this.seedOut = src;

    gl.useProgram(this.distP.prog);
    gl.bindTexture(gl.TEXTURE_2D, this.seeds[src]!);
    gl.uniform1i(this.distP.u('uSeeds'), 0);
    gl.uniform1f(this.distP.u('uScale'), field.scale);
    pass(this.distTex);
  }

  /**
   * Runs the effect into the bound framebuffer and viewport (a full-screen triangle; texels outside the field come
   * out transparent). `origin` is the field's top-left in that target's CSS px, `targetH` its CSS height and `dpr` its
   * pixels per CSS px.
   */
  draw(
    base: WebGLTexture,
    origin: { x: number; y: number },
    targetH: number,
    dpr: number,
    time: number,
    uniforms: SetUniforms,
  ): void {
    const gl = this.gl;
    const p = this.fxP;
    gl.useProgram(p.prog);
    const binds: [number, WebGLTexture, string][] = [
      [0, base, 'uBase'],
      [1, this.distTex, 'uDist'],
      [2, this.seeds[this.seedOut]!, 'uSeeds'],
    ];
    for (const [unit, tex, name] of binds) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(p.u(name), unit);
    }
    const { field, elem } = this;
    gl.uniform4f(p.u('uElem'), elem.x, elem.y, elem.w, elem.h);
    gl.uniform1f(p.u('uScale'), field.scale);
    gl.uniform2f(p.u('uField'), field.w, field.h);
    gl.uniform2f(p.u('uOrigin'), origin.x, origin.y);
    gl.uniform1f(p.u('uCanvasH'), targetH);
    gl.uniform1f(p.u('uDpr'), dpr);
    gl.uniform1f(p.u('uTime'), time);
    uniforms(gl, p.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
