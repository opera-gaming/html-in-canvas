// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// The DOM side of page interaction (pure geometry in interact.ts): finding the real control at a page point and
// operating it. The page never moves or reflows (layout guard in page.css), so every control keeps the page rect it
// had when the bodies were extracted.
//
// Hit testing. document.elementFromPoint cannot be used: the page is 3072 CSS px square inside a fixed canvas, the
// viewport is much smaller, and elementFromPoint returns null for any point outside the viewport (and the opaque view
// canvas is on top inside it). So the interactive elements' page rects are collected once and searched instead.
import { controlKind, isTextEntry, nextOption, rangeValueAt, type ControlKind } from './interact';

/** Elements a click can operate; label covers both wrapping labels and <label for> captions. */
const INTERACTIVE =
  'input, button, select, textarea, label, summary, [role=switch], [role=button], [role=checkbox], [role=tab]';

export interface PageControl {
  el: HTMLElement;
  kind: ControlKind;
  rect: { left: number; top: number; width: number; height: number };
}

export interface PageControls {
  /** The control at page point (px, py), already resolved through labels, or null. */
  at(px: number, py: number): PageControl | null;
  /** Operates a click/select/color control (text fields are focused by the caller, ranges dragged with setRange). */
  act(c: PageControl): void;
  /** Sets a range input from page x and fires input (and change when `commit`). */
  setRange(c: PageControl, px: number, commit: boolean): void;
}

/** Colours a colour input cycles through on click (no native picker). */
const COLOURS = ['#ff1b2d', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#1b1f2a'];

export function createPageControls(root: HTMLElement): PageControls {
  const origin = root.getBoundingClientRect();
  const rectOf = (el: Element): PageControl['rect'] => {
    const r = el.getBoundingClientRect();
    return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
  };
  const items = [...root.querySelectorAll<HTMLElement>(INTERACTIVE)]
    .map((el) => ({ el, rect: rectOf(el) }))
    .filter(({ rect }) => rect.width >= 2 && rect.height >= 2);

  // Never navigate or submit: a click must not leave the demo.
  root.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault();
    },
    true,
  );
  root.addEventListener('submit', (e) => e.preventDefault(), true);
  // A date field's picker opens with Alt+↓ / F4: keep it closed (typing still edits the field).
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    const picker = /^(date|time|datetime-local|month|week)$/.test(t.type);
    if (t.tagName === 'INPUT' && picker && (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) e.preventDefault();
  });
  root.addEventListener('click', (e) => {
    // Tabs (the playground's) only restyle: no panel swaps, no layout change.
    const tab = (e.target as Element | null)?.closest?.('.op-tab');
    if (!tab) return;
    for (const t of tab.parentElement?.querySelectorAll('.op-tab') ?? []) t.classList.toggle('op-tab-on', t === tab);
  });

  /**
   * A label acts on its form control (a click on the checkbox / radio itself, focus for a text field, a cycle for a
   * select, …); a label of a progress bar or meter does nothing.
   */
  const resolve = (el: HTMLElement): HTMLElement | null => {
    if (!(el instanceof HTMLLabelElement)) return el;
    const c = el.control;
    return c && !(c instanceof HTMLProgressElement || c instanceof HTMLMeterElement) ? c : null;
  };

  return {
    at(px, py) {
      let best: (typeof items)[number] | null = null;
      for (const it of items) {
        const r = it.rect;
        if (px < r.left || py < r.top || px > r.left + r.width || py > r.top + r.height) continue;
        // Innermost: a hit inside the current best (or simply smaller) wins.
        if (!best || best.el.contains(it.el) || r.width * r.height < best.rect.width * best.rect.height) best = it;
      }
      if (!best) return null;
      const el = resolve(best.el);
      if (!el || (el as HTMLInputElement).disabled) return null;
      return { el, kind: controlKind(el), rect: el === best.el ? best.rect : rectOf(el) };
    },
    act(c) {
      const el = c.el;
      if (c.kind === 'select') {
        const s = el as HTMLSelectElement;
        s.selectedIndex = nextOption(s.selectedIndex, s.options.length);
        s.dispatchEvent(new Event('input', { bubbles: true }));
        s.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (c.kind === 'color') {
        const i = el as HTMLInputElement;
        const k = COLOURS.indexOf(i.value.toLowerCase());
        i.value = COLOURS[(k + 1) % COLOURS.length]!;
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (c.kind === 'click') {
        el.click();
      }
    },
    setRange(c, px, commit) {
      const i = c.el as HTMLInputElement;
      const min = Number(i.min || 0),
        max = Number(i.max || 100),
        step = i.step === 'any' ? 0 : Number(i.step || 1);
      const v = String(rangeValueAt(px, c.rect.left, c.rect.width, min, max, step));
      if (v !== i.value) {
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (commit) i.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };
}

/** True when the focused element is a text field inside `root` (the keyboard then belongs to the page). */
export function pageFieldFocused(root: HTMLElement): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  return a && root.contains(a) && isTextEntry(a) ? a : null;
}
