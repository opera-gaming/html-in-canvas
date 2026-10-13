// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** A rectangle on the page in layout (CSS px) coordinates, relative to the page root. */
export interface RawRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'word' | 'object';
}

/** Initial state of one physics body: centre, size and the texture UV box it shows. */
export interface BodyInit {
  cx: number;
  cy: number;
  w: number;
  h: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  word: boolean;
}

/**
 * Elements that become a single body each; their subtrees are not split into words. Form controls are one body each,
 * and so is a label wrapping an input (a radio, checkbox or toggle switch together with its text).
 */
export const OBJECT_SELECTOR =
  'img, svg, video, canvas, button, input, hr, select, textarea, progress, meter, label:has(input), [data-dozer-object]';

/** Offsets (UTF-16 code units) of each non-whitespace run in `text`. */
export function splitWords(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Clips rects to the page, drops degenerate ones (< 1 px), and sorts by area, largest first. */
export function rectsToBodies(rects: RawRect[], pageSize: number): BodyInit[] {
  const out: BodyInit[] = [];
  for (const r of rects) {
    if (r.w < 1 || r.h < 1) continue;
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(pageSize, r.x + r.w);
    const y1 = Math.min(pageSize, r.y + r.h);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 1 || h < 1) continue;
    out.push({
      cx: x0 + w / 2,
      cy: y0 + h / 2,
      w,
      h,
      u0: x0 / pageSize,
      v0: y0 / pageSize,
      u1: x1 / pageSize,
      v1: y1 / pageSize,
      word: r.kind === 'word',
    });
  }
  return out.sort((a, b) => b.w * b.h - a.w * a.h);
}

/**
 * Walks the laid-out page and returns one rect per word fragment (a wrapped word
 * yields one per line) and one per object element. Coordinates are relative to
 * the root's border box and divided by `root.dataset.scale` (default 1) to undo
 * any CSS scale applied to the root.
 */
export function extractRects(root: HTMLElement): RawRect[] {
  const scale = Number(root.dataset.scale ?? '1') || 1;
  const origin = root.getBoundingClientRect();
  const out: RawRect[] = [];
  const push = (r: DOMRect, kind: RawRect['kind']): void => {
    if (r.width <= 0 || r.height <= 0) return;
    out.push({
      x: (r.left - origin.left) / scale,
      y: (r.top - origin.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
      kind,
    });
  };

  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      if (el.matches(OBJECT_SELECTOR)) {
        push(el.getBoundingClientRect(), 'object');
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    for (const { start, end } of splitWords(text)) {
      range.setStart(node, start);
      range.setEnd(node, end);
      for (const r of range.getClientRects()) push(r, 'word');
    }
  }
  return out;
}
