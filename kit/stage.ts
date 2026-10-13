// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// A live panel (canvas child) re-captured on every `paint` event and drawn through an SDF effect where `place` puts
// it; its hit-test box follows, so its controls stay usable.
import { captureInto, fitCanvas, initGL, makeTexture, placeElement } from './gl';
import { SdfEffect, type Margin, type SetUniforms } from './sdf';

export { colourValue, hexToLinear, rangeValue } from './gl';

export interface StageOptions {
  canvas: HTMLCanvasElement;
  panel: HTMLElement;
  /** Room around the panel for the effect, CSS px. */
  margin: Margin;
  /** Top-left of the panel in the canvas, CSS px, for a canvas and panel of the given sizes. */
  place: (canvasW: number, canvasH: number, panelW: number, panelH: number) => { x: number; y: number };
  /** GLSL defining `vec4 effect(vec2 fp)`; see EFFECT_PRELUDE for what it can use. */
  effect: string;
  /** Sets the effect's own uniforms each frame. */
  uniforms: SetUniforms;
}

export function createStage(opts: StageOptions): void {
  const { canvas, panel, margin } = opts;
  const gl = initGL(canvas, { float: true });
  const fx = new SdfEffect(gl, opts.effect);
  const baseTex = makeTexture(gl, gl.LINEAR);
  let origin = { x: 0, y: 0 }; // the field's top-left in the canvas, CSS px

  const layout = (): void => {
    fitCanvas(canvas);
    const pw = panel.offsetWidth,
      ph = panel.offsetHeight;
    const at = opts.place(canvas.clientWidth, canvas.clientHeight, pw, ph);
    const px = Math.round(at.x),
      py = Math.round(at.y);
    fx.resize(pw, ph, margin);
    origin = { x: px - margin.left, y: py - margin.top };
    placeElement(canvas, panel, px, py);
  };

  let captured = false;
  let dirty = true;
  const start = performance.now();

  const frame = (): void => {
    requestAnimationFrame(frame);
    if (!captured) return;
    if (dirty) {
      layout();
      fx.build(baseTex);
      dirty = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    fx.draw(
      baseTex,
      origin,
      canvas.clientHeight,
      canvas.width / canvas.clientWidth,
      (performance.now() - start) / 1000,
      opts.uniforms,
    );
  };

  // Re-capture whenever the panel repaints (dragging, focus, a readout changing).
  canvas.addEventListener('paint', () => {
    captureInto(gl, baseTex, panel);
    captured = true;
    dirty = true;
  });
  window.addEventListener('resize', () => {
    dirty = true;
    canvas.requestPaint!();
  });

  layout();
  canvas.requestPaint!();
  requestAnimationFrame(frame);
}

/** A `place` for a panel centred below `controls` (the page's top bar), a little above the middle when there is room. */
export function belowControls(controls: HTMLElement): StageOptions['place'] {
  return (cw, ch, pw) => {
    const top = controls.getBoundingClientRect().bottom;
    return { x: (cw - pw) / 2, y: Math.max(top + 36, Math.min(ch * 0.55 - 160, top + 120)) };
  };
}

/**
 * A pill switch (`<button role="switch" aria-checked>`) driving a 0..1 phase over `duration()` seconds: 0 = on (panel
 * here), 1 = off (gone). `cycle` counts trips; reversing mid-way keeps the current one. The panel is inert unless on.
 */
export function switchPhase(toggle: HTMLButtonElement, panel: HTMLElement, duration: () => number) {
  const on = (): boolean => toggle.getAttribute('aria-checked') === 'true';
  const state = { phase: on() ? 0 : 1, cycle: 0 };
  panel.inert = !on();
  toggle.addEventListener('click', () => {
    if (state.phase === 0 || state.phase === 1) state.cycle += 1;
    toggle.setAttribute('aria-checked', String(!on()));
    panel.inert = !on();
  });
  let last = performance.now();
  return {
    state,
    /** Advances the phase to now; call once per frame. */
    tick(): void {
      const now = performance.now();
      const by = (now - last) / 1000 / Math.max(0.1, duration());
      last = now;
      const target = on() ? 0 : 1;
      state.phase = target > state.phase ? Math.min(target, state.phase + by) : Math.max(target, state.phase - by);
    },
  };
}
