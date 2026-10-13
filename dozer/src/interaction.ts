// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Pointer and keyboard glue for operating the real page through the view canvas. A press on the view canvas reads
// the body buffers back (gpu/pickread.ts), picks the topmost body under the cursor (interact.ts), maps the cursor to
// that body's original page position and operates the real control there (pagecontrols.ts). The page re-capture
// (capture.ts createRecapturer) then shows the new state on the body, wherever it has been pushed.
import {
  mapThroughBody,
  pickBody,
  screenToWorld,
  type BodySnapshot,
  type HeightScale,
  type ViewState,
} from './interact';
import { pageFieldFocused, type PageControl, type PageControls } from './pagecontrols';
import type { BodyReader } from './gpu/pickread';

export interface InteractionDeps {
  view: HTMLCanvasElement;
  root: HTMLElement;
  controls: PageControls;
  reader: BodyReader;
  /** Camera of the last rendered frame. */
  viewState: () => ViewState;
  /** True when world point (x, y) is on the dozer's drawn body (which covers the words under it). */
  onDozer: (x: number, y: number) => boolean;
  /** Re-capture the page at the next paint. */
  recapture: () => void;
  /** "Typing: Esc to drive" badge. */
  badge: HTMLElement;
  /** Called when a page text field gains or loses focus (the dozer releases its held keys). */
  onTyping: (typing: boolean) => void;
  heightScale: HeightScale;
  pageSize: number;
  /** `?debug`: log every pick. */
  debug?: boolean;
}

/** Hover picks reuse a snapshot up to this old (ms). */
const HOVER_MS = 100;

export function createInteraction(d: InteractionDeps): void {
  const { view, controls, reader } = d;
  const local = (e: PointerEvent): [number, number] => {
    const r = view.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  /** The control the pointer would operate at view CSS point (sx, sy). */
  const controlAt = (
    sx: number,
    sy: number,
    snap: BodySnapshot,
  ): { control: PageControl; index: number; page: [number, number] } | null => {
    const [wx, wy] = screenToWorld(sx, sy, d.viewState());
    if (d.onDozer(wx, wy)) return null;
    const pick = pickBody(snap, wx, wy, d.pageSize, d.heightScale);
    if (!pick) return null;
    const control = controls.at(pick.page[0], pick.page[1]);
    return control ? { control, index: pick.index, page: pick.page } : null;
  };

  /** A held slider drag: the slider, its body and the snapshot it was picked from (the body holds still meanwhile). */
  let drag: { control: PageControl; index: number; snap: BodySnapshot; pointerId: number } | null = null;
  /** The press waiting for its readback: where the pointer is now and whether it was released meanwhile. */
  let pending: { pointerId: number; at: [number, number]; released: boolean } | null = null;
  const rangeAt = (at: [number, number], commit: boolean): void => {
    if (!drag) return;
    const [wx, wy] = screenToWorld(at[0], at[1], d.viewState());
    const { page } = mapThroughBody(drag.snap, drag.index, wx, wy, d.pageSize, d.heightScale);
    controls.setRange(drag.control, page[0], commit);
    d.recapture();
  };

  // Keep the focus where it is (a page text field) when the canvas is pressed: the default would focus the body.
  view.addEventListener('mousedown', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const [sx, sy] = local(e);
    const press = { pointerId: e.pointerId, at: [sx, sy] as [number, number], released: false };
    pending = press;
    try {
      view.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    const t = performance.now();
    void reader
      .read(t)
      .then((snap) => {
        if (pending === press) pending = null;
        const hit = controlAt(sx, sy, snap);
        if (d.debug) {
          const [wx, wy] = screenToWorld(sx, sy, d.viewState());
          const pick = pickBody(snap, wx, wy, d.pageSize, d.heightScale);
          const page = pick ? pick.page.map((v) => v.toFixed(0)).join(',') : '-';
          const control = hit ? `${hit.control.el.tagName}.${hit.control.el.className}:${hit.control.kind}` : '-';
          console.log(
            `[dozer] pick screen=${sx.toFixed(0)},${sy.toFixed(0)} world=${wx.toFixed(0)},${wy.toFixed(0)} ` +
              `body=${pick?.index ?? '-'} page=${page} control=${control}`,
          );
        }
        const focused = pageFieldFocused(d.root);
        if (focused && hit?.control.el !== focused) focused.blur();
        if (!hit) return;
        const c = hit.control;
        if (c.kind === 'text') {
          c.el.focus({ preventScroll: true });
        } else if (c.kind === 'range') {
          // The pointer may have moved (or been released) while the readback was in flight: use where it is now.
          drag = { control: c, index: hit.index, snap, pointerId: press.pointerId };
          rangeAt(press.at, press.released);
          if (press.released) drag = null;
        } else {
          controls.act(c);
          d.recapture();
        }
      })
      .catch((err) => console.warn('[dozer] pick failed:', err));
  });
  const end = (e: PointerEvent): void => {
    if (pending && pending.pointerId === e.pointerId) {
      pending.at = local(e);
      pending.released = true;
    }
    if (drag && drag.pointerId === e.pointerId) {
      rangeAt(local(e), true);
      drag = null;
    }
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  // Hover: the cursor shows what a click would do (pointer over controls, text over text fields).
  let hoverAt: [number, number] | null = null;
  let hoverPending = false;
  const updateCursor = (snap: BodySnapshot): void => {
    if (!hoverAt) return;
    const hit = controlAt(hoverAt[0], hoverAt[1], snap);
    view.style.cursor = !hit || hit.control.kind === 'none' ? '' : hit.control.kind === 'text' ? 'text' : 'pointer';
  };
  view.addEventListener('pointermove', (e) => {
    if (pending && pending.pointerId === e.pointerId) pending.at = local(e);
    if (drag && drag.pointerId === e.pointerId) {
      rangeAt(local(e), false);
      return;
    }
    hoverAt = local(e);
    const latest = reader.latest();
    if (latest && performance.now() - latest.time < HOVER_MS) {
      updateCursor(latest);
      return;
    }
    if (hoverPending) return;
    hoverPending = true;
    void reader
      .read(performance.now() - HOVER_MS)
      .then(updateCursor, () => undefined)
      .finally(() => {
        hoverPending = false;
      });
  });
  view.addEventListener('pointerleave', () => {
    hoverAt = null;
    view.style.cursor = '';
  });

  // Esc hands the keyboard back to the dozer.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      const focused = pageFieldFocused(d.root);
      if (!focused) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      focused.blur();
    },
    true,
  );
  const syncTyping = (): void => {
    // focusout fires before the new element gains focus: look once the focus has settled.
    queueMicrotask(() => {
      const typing = pageFieldFocused(d.root) !== null;
      d.badge.hidden = !typing;
      d.onTyping(typing);
      d.recapture(); // the caret and the focus ring appear or vanish
    });
  };
  d.root.addEventListener('focusin', syncTyping);
  d.root.addEventListener('focusout', syncTyping);
}
