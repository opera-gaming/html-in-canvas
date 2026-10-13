// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// On-screen "Drive" hint shown after the intro stops: keycaps for the arrow keys and WASD (DOM overlay, styled and
// animated in index.html). It disappears on the first driving key press.

/** Keys that drive the dozer (dozer.ts KEYS without Space): pressing one hides the hint. */
export const DRIVE_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
]);

export interface KeyHint {
  show(): void;
  hide(): void;
  visible(): boolean;
}

function cluster(keys: [string, string][]): HTMLElement {
  const g = document.createElement('div');
  g.className = 'kh-cluster';
  keys.forEach(([label, area]) => {
    const k = document.createElement('kbd');
    k.className = 'kh-key';
    k.textContent = label;
    k.style.gridArea = area;
    g.append(k);
  });
  return g;
}

/** Builds the hint inside `el` (hidden until show()). */
export function createKeyHint(el: HTMLElement): KeyHint {
  el.replaceChildren();
  el.setAttribute('aria-live', 'polite');
  const keys = document.createElement('div');
  keys.className = 'kh-keys';
  const or = document.createElement('span');
  or.className = 'kh-or';
  or.textContent = 'or';
  keys.append(
    cluster([
      ['↑', 'up'],
      ['←', 'left'],
      ['↓', 'down'],
      ['→', 'right'],
    ]),
    or,
    cluster([
      ['W', 'up'],
      ['A', 'left'],
      ['S', 'down'],
      ['D', 'right'],
    ]),
  );
  const label = document.createElement('div');
  label.className = 'kh-label';
  label.textContent = 'Drive';
  el.append(keys, label);
  el.hidden = true;
  return {
    show() {
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    visible: () => !el.hidden,
  };
}
