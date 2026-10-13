// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Slider on Fire: the panel burns along its edges; the slider sets how hard.
import { FIRE_EFFECT, fireUniforms } from '@kit/fire-effect';
import { createStage, rangeValue } from '@kit/stage';

const heat = rangeValue(document.getElementById('heat') as HTMLInputElement, (v) => `${v}%`);

createStage({
  canvas: document.getElementById('view') as HTMLCanvasElement,
  panel: document.getElementById('panel') as HTMLElement,
  // smoke rises well above the panel
  margin: { top: 300, right: 90, bottom: 40, left: 90 },
  place: (cw, ch, pw, ph) => ({ x: (cw - pw) / 2, y: Math.max(300, ch * 0.6 - ph / 2) }),
  effect: FIRE_EFFECT,
  uniforms: (gl, u) => fireUniforms(heat() / 100)(gl, u),
});
