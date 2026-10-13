// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Texture, WebGLRenderer } from 'three';

/*
 * Uploads screen textures inside the canvas `paint` event and holds rendering until every screen has uploaded once.
 *
 * Uploads must happen in the paint event: only there is an element's paint record guaranteed valid, and three may
 * draw a mesh twice per frame (transmission pre-pass) and upload before any paint exists. So three never uploads on
 * its own (ScreenSurface.attachTo sets texture.version = 0); this listener sets needsUpdate and calls initTexture().
 *
 * `changedElements` may list only some elements, so the gate opens once every screen has been seen, or after
 * `timeoutMs`. Once open, uploads are throttled (animated pages repaint every frame): the priority screen uploads on
 * every paint, the others at most every `backgroundIntervalMs` and one per paint; held-back screens stay dirty and
 * request another paint.
 */
/**
 * three uploads an HTMLTexture, generates its mipmaps when `generateMipmaps` is set, and then
 * forces TEXTURE_MIN_FILTER to LINEAR, so the mipmaps are never sampled. Put the trilinear
 * filter back so a minified page is averaged instead of shimmering.
 */
function restoreMipmapFilter(renderer: WebGLRenderer, texture: Texture): void {
  if (!texture.generateMipmaps) return;
  const webglTexture = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
  if (!webglTexture) return;
  const gl = renderer.getContext();
  renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
}

export function createPaintGate(
  canvas: HTMLCanvasElement,
  renderer: WebGLRenderer,
  surfaces: { id?: string; element: HTMLElement; texture: Texture }[],
  timeoutMs = 2000,
  backgroundIntervalMs = 66,
): { ready(): boolean; setPriority(element: Element | null): void } {
  const seen = new Set<Element>();
  const dirty = new Set<Element>();
  const lastUpload = new Map<Element, number>();
  let priority: Element | null = null;
  const warned = new Set<Element>();
  const expected: Element[] = surfaces.map((s) => s.element);
  const startedAt = performance.now();
  let open = false;

  const upload = (el: Element, now: number) => {
    const s = surfaces.find((x) => x.element === el)!;
    try {
      s.texture.needsUpdate = true;
      renderer.initTexture(s.texture);
      restoreMipmapFilter(renderer, s.texture);
    } catch (err) {
      if (!warned.has(el)) {
        warned.add(el);
        console.warn('[paint] texture upload failed', err);
      }
    }
    seen.add(el);
    dirty.delete(el);
    lastUpload.set(el, now);
  };

  canvas.addEventListener('paint', (ev) => {
    for (const el of (ev as PaintEvent).changedElements ?? []) if (expected.includes(el)) dirty.add(el);
    const now = performance.now();
    let backgroundSlots = 1;
    for (const el of [...dirty]) {
      if (!open || el === priority || !seen.has(el)) {
        upload(el, now);
        continue;
      }
      if (backgroundSlots > 0 && now - (lastUpload.get(el) ?? -Infinity) >= backgroundIntervalMs) {
        backgroundSlots--;
        upload(el, now);
      }
    }
    if (dirty.size) canvas.requestPaint?.();
  });
  canvas.requestPaint?.();

  return {
    setPriority(element) {
      priority = element;
    },
    ready() {
      if (open) return true;
      if (expected.every((el) => seen.has(el))) return (open = true);
      if (performance.now() - startedAt > timeoutMs) {
        // Hand unseen screens to three's own render-time upload path as a last resort.
        const missing = surfaces.map((s, i) => ({ s, i })).filter(({ s }) => !seen.has(s.element));
        for (const { s } of missing) s.texture.needsUpdate = true;
        console.warn(
          `[paint] gate timed out after ${timeoutMs}ms; never painted: ${missing.map(({ s, i }) => s.id ?? `#${i}`).join(', ')}` +
            ' (falling back to render-time upload)',
        );
        return (open = true);
      }
      return false;
    },
  };
}
