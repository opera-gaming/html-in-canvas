// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { NoToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import { installShim } from '../compat/htmlInCanvas';
import type { HtmlInCanvasApi } from '../capabilities';

export function createRenderer(container: HTMLElement, api: HtmlInCanvasApi): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // Capped at 1.5: the post stack is fill-rate bound.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // tone mapping happens once, in the post stack
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false; // all shadows are baked into the lightmaps
  installShim(renderer.getContext() as WebGL2RenderingContext & Record<string, unknown>, api);
  container.appendChild(renderer.domElement);
  return renderer;
}
