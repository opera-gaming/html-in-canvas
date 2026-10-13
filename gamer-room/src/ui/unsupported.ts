// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Capabilities } from '../capabilities';

export function showUnsupported(root: HTMLElement, caps: Capabilities): void {
  const reason = caps.webgl2
    ? 'This browser has WebGL2 but the HTML-in-Canvas API is not enabled.'
    : 'This browser has no WebGL2 context.';
  root.innerHTML = `
    <div class="unsupported">
      <h1>HTML-in-Canvas not available</h1>
      <p>${reason}</p>
      <p>Enable it in Opera GX / Chromium 149+:</p>
      <ol>
        <li>Open <code>opera://flags/#canvas-draw-element</code> (Chrome: <code>chrome://flags/#canvas-draw-element</code>)</li>
        <li>Set it to <b>Enabled</b> and relaunch</li>
      </ol>
      <p>Or launch with <code>--enable-blink-features=CanvasDrawElement</code>.</p>
    </div>`;
}

/** Boot failure panel, styled like the unsupported notice. Built with DOM APIs so the message is never parsed as HTML. */
export function showError(root: HTMLElement, err: unknown): void {
  const panel = document.createElement('div');
  panel.className = 'unsupported';
  const h = document.createElement('h1');
  h.textContent = 'Something went wrong';
  const pre = document.createElement('pre');
  pre.textContent = err instanceof Error ? err.message : String(err);
  panel.append(h, pre);
  root.replaceChildren(panel);
}
