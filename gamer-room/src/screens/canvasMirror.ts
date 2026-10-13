// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/**
 * Chromium up to at least 152 (Opera GX 136) leaves a WebGPU canvas out of an iframe's HTML-in-Canvas snapshot:
 * the page's DOM shows on the screen but the canvas is black. A 2D canvas is captured, so this lays one over the
 * WebGPU canvas and copies each frame into it. The copy runs in a microtask after the page's last queue.submit
 * of the task, while the frame's texture is still readable (it is cleared once presented), so once per frame.
 * Newer Chromium captures the WebGPU canvas itself; the mirror then covers it with identical pixels.
 */
export function mirrorWebGpuCanvas(win: Window, selector: string): boolean {
  const doc = win.document;
  const source = doc.querySelector<HTMLCanvasElement>(selector);
  // The room itself has no WebGPU types; only the queue's submit is touched.
  type Submit = (...args: unknown[]) => void;
  const queueClass = (win as Window & { GPUQueue?: { prototype: { submit: Submit } } }).GPUQueue;
  if (!source || !queueClass || source.dataset.mirrored) return false;
  source.dataset.mirrored = '1';

  const mirror = doc.createElement('canvas');
  mirror.style.cssText = 'position:absolute;pointer-events:none;';
  const place = (): void => {
    mirror.style.left = `${source.offsetLeft}px`;
    mirror.style.top = `${source.offsetTop}px`;
    mirror.style.width = `${source.offsetWidth}px`;
    mirror.style.height = `${source.offsetHeight}px`;
  };
  source.after(mirror);
  place();
  win.addEventListener('resize', place);
  const ctx = mirror.getContext('2d')!;

  let pending = false;
  const copy = (): void => {
    pending = false;
    if (source.width === 0 || source.height === 0) return;
    // At CSS pixel size, not device pixels: the room draws the screen at 1x anyway and the copy costs half as much.
    const w = Math.max(1, source.offsetWidth),
      h = Math.max(1, source.offsetHeight);
    if (mirror.width !== w || mirror.height !== h) {
      mirror.width = w;
      mirror.height = h;
      place();
    }
    ctx.drawImage(source, 0, 0, w, h);
  };
  const submit = queueClass.prototype.submit;
  queueClass.prototype.submit = function (this: unknown, ...args: unknown[]) {
    submit.apply(this, args);
    if (!pending) {
      pending = true;
      win.queueMicrotask(copy);
    }
  };
  return true;
}
