// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { Mode } from '../app/state';

export interface Overlay {
  setMode(mode: Mode): void;
  onBack(cb: () => void): void;
  setHint(text: string): void;
  /** The room is ready: the loading veil goes and `cb` runs (once). */
  ready(cb: () => void): void;
  onMute(cb: () => void): void;
  setMuted(m: boolean): void;
}

/** Hides the start splash without starting (boot failed or unsupported). */
export function removeSplash(): void {
  const splash = document.getElementById('splash');
  if (splash) splash.hidden = true;
}

/** `splash` is the static loading veil in index.html, showing "Loading the room…" from first paint until ready. */
export function createOverlay(root: HTMLElement, splash: HTMLElement): Overlay {
  const back = document.createElement('button');
  back.className = 'back';
  back.textContent = '← Back';
  back.hidden = true;
  const hint = document.createElement('div');
  hint.className = 'hint';
  const mute = document.createElement('button');
  mute.className = 'mute';
  mute.textContent = '🔊';
  mute.setAttribute('aria-label', 'Mute music');
  mute.setAttribute('aria-pressed', 'false');
  root.append(back, hint, mute);

  let backCb: () => void = () => {};
  back.addEventListener('click', () => backCb());
  let muteCb: () => void = () => {};
  mute.addEventListener('click', () => muteCb());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') backCb();
  });

  let started = false;
  return {
    setMode(mode) {
      back.hidden = mode !== 'focus';
      hint.hidden = mode !== 'overview';
    },
    onBack(cb) {
      backCb = cb;
    },
    setHint(text) {
      hint.textContent = text;
    },
    ready(cb) {
      if (started) return;
      started = true;
      splash.classList.add('done'); // fades out (style.css), then hides
      setTimeout(() => (splash.hidden = true), 400);
      cb();
    },
    onMute(cb) {
      muteCb = cb;
    },
    setMuted(m) {
      mute.textContent = m ? '🔇' : '🔊';
      mute.setAttribute('aria-pressed', String(m));
    },
  };
}
