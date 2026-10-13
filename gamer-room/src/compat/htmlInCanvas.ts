// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { HtmlInCanvasApi } from '../capabilities';

type GL = WebGL2RenderingContext & Record<string, unknown>;

/**
 * Makes three.js's HTMLTexture upload path work on builds that only expose
 * the newer texElementSubImage2D. three calls texElementImage2D(target,
 * internalFormat, element) when the function's arity is 3.
 */
export function installShim(gl: GL, api: HtmlInCanvasApi): void {
  if (api !== 'texElementSubImage2D') return;
  if (typeof gl.texElementImage2D === 'function') return;

  const sub = gl.texElementSubImage2D as (target: number, level: number, x: number, y: number, el: Element) => void;

  const shim = function (this: GL, target: number, internalFormat: number, element: HTMLElement) {
    const w = Math.max(1, element.offsetWidth);
    const h = Math.max(1, element.offsetHeight);
    this.texImage2D(target, 0, internalFormat, w, h, 0, this.RGBA, this.UNSIGNED_BYTE, null);
    sub.call(this, target, 0, 0, 0, element);
  };
  Object.defineProperty(shim, 'length', { value: 3 });
  gl.texElementImage2D = shim;
}

/** Sets both the old (layoutsubtree) and new (content=drawable + drawable) attributes. */
export function markDrawable(canvas: HTMLCanvasElement, element: HTMLElement): void {
  if (!canvas.hasAttribute('layoutsubtree')) canvas.setAttribute('layoutsubtree', 'true');
  if (canvas.getAttribute('content') !== 'drawable') canvas.setAttribute('content', 'drawable');
  element.setAttribute('drawable', '');
}
