// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { FULLSCREEN_VS } from './shaders';
import './page.css';

declare global {
  interface HTMLCanvasElement {
    requestPaint?: () => void;
    updateElementGeometry?: (el: Element, options?: { canvasTransform?: DOMMatrixInit }) => void;
  }
  interface WebGL2RenderingContext {
    texElementImage2D?: (...args: unknown[]) => void;
  }
}

/** Shows the "unsupported" message (creating it unless the page has its own) and stops the demo. */
function unsupported(why: string): never {
  let box = document.getElementById('unsupported');
  if (!box) {
    box = document.createElement('div');
    box.id = 'unsupported';
    box.innerHTML = `<div>
  <p id="unsupported-why"></p>
  <p>Use Opera GX or another recent Chromium with <code>opera://flags/#canvas-draw-element</code>
    (or <code>chrome://flags/#canvas-draw-element</code>) enabled, then relaunch.</p>
</div>`;
    document.body.append(box);
  }
  const text = document.getElementById('unsupported-why');
  if (text) text.textContent = why;
  box.hidden = false;
  throw new Error(why);
}

/** A WebGL2 context on a layoutsubtree canvas, or the "unsupported" message. `float` also requires float targets. */
export function initGL(canvas: HTMLCanvasElement, opts: { float?: boolean } = {}): WebGL2RenderingContext {
  const gl =
    canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false }) ??
    unsupported('This demo needs WebGL2.');
  if (typeof gl.texElementImage2D !== 'function' || typeof canvas.requestPaint !== 'function') {
    unsupported('HTML-in-Canvas is not enabled in this browser.');
  }
  if (opts.float && !gl.getExtension('EXT_color_buffer_float')) {
    unsupported('This demo needs float render targets (EXT_color_buffer_float).');
  }
  // Every demo builds its GPU state once at startup, so recover from a lost context by starting over.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  gl.bindVertexArray(gl.createVertexArray());
  return gl;
}

export interface Program {
  prog: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

/** Links `fs` with a full-screen-triangle vertex shader (`vs` overrides it). Throws with the info log on failure. */
export function makeProgram(gl: WebGL2RenderingContext, fs: string, vs: string = FULLSCREEN_VS): Program {
  const prog = gl.createProgram()!;
  const shaders: WebGLShader[] = [];
  try {
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type)!;
      shaders.push(s);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
  } catch (err) {
    gl.deleteProgram(prog);
    throw err;
  } finally {
    // The linked program keeps what it needs; the shader objects are no longer used.
    for (const s of shaders) gl.deleteShader(s);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string): WebGLUniformLocation | null => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
    return cache.get(name)!;
  };
  return { prog, u };
}

export function makeTexture(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Uploads a canvas child's latest snapshot into `tex` (call from a `paint` listener). Row 0 is the element's top. */
export function captureInto(gl: WebGL2RenderingContext, tex: WebGLTexture, el: Element): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const upload = gl.texElementImage2D!;
  if (upload.length === 3) upload.call(gl, gl.TEXTURE_2D, gl.RGBA8, el);
  else upload.call(gl, gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
}

/**
 * Makes a canvas child hit-testable where it is drawn, at (x, y) CSS px in the canvas. Chromium needs
 * updateElementGeometry for hit testing but takes the position from the CSS transform, so set both. The capture is
 * unaffected by the transform.
 */
export function placeElement(canvas: HTMLCanvasElement, el: HTMLElement, x: number, y: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.updateElementGeometry?.(el, { canvasTransform: new DOMMatrix().scale(dpr).translate(x, y) });
  const move = `translate(${x}px, ${y}px)`;
  if (el.style.transform !== move) el.style.transform = move;
}

/** Matches the canvas backing store to its CSS size × devicePixelRatio. */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr),
    h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** Renders a full-screen triangle into `target` (null = the canvas) over a w × h viewport. */
export function drawTo(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null,
  target: WebGLTexture | null,
  w: number,
  h: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? fbo : null);
  if (target) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** '#rrggbb' to linear RGB, for emissive colours. */
export function hexToLinear(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const c = (x: number): number => Math.pow(x / 255, 2.2);
  return [c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255)];
}

/**
 * Returns a live getter for a colour input's value in linear RGB (converted only when it changes). With `accent`, the
 * page's --accent follows it too.
 */
export function colourValue(input: HTMLInputElement, opts: { accent?: boolean } = {}): () => [number, number, number] {
  let rgb = hexToLinear(input.value);
  const sync = (): void => {
    rgb = hexToLinear(input.value);
    if (opts.accent) document.documentElement.style.setProperty('--accent', input.value);
  };
  input.addEventListener('input', sync);
  sync();
  return () => rgb;
}

/** Binds a range input to a readout (`<output for=…>`) and returns a live getter for its value. */
export function rangeValue(input: HTMLInputElement, format: (v: number) => string = String): () => number {
  const out = document.querySelector<HTMLOutputElement>(`output[for="${input.id}"]`);
  const sync = (): void => {
    if (out) out.value = format(Number(input.value));
  };
  input.addEventListener('input', sync);
  sync();
  return () => Number(input.value);
}
