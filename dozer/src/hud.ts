// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// On-screen HUD: one stats line plus the key hints, bottom-left (styled in index.html, no pointer events).

/** bodies = live slots incl. fragments; active = awake this frame; cap = maxBodies. */
export interface Stats {
  fps: number;
  bodies: number;
  active: number;
  asleep: number;
  fragments: number;
  gridOverflow: number;
  cap: number;
}

export const HUD_HINTS = 'WASD/arrows drive · Space brake · R reset · M mute';

/** Locale-independent thousands grouping (12345 → "12,345"). */
const group = (n: number): string =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** e.g. "60 fps · 12,345 bodies (812 awake, 11,533 asleep) · 37 fragments · cap 32,768[ · grid overflow 12]". */
export function formatHud(s: Stats): string {
  const parts = [
    `${Math.round(s.fps)} fps`,
    `${group(s.bodies)} bodies (${group(s.active)} awake, ${group(s.asleep)} asleep)`,
    `${group(s.fragments)} fragments`,
    `cap ${group(s.cap)}`,
  ];
  if (s.gridOverflow > 0) parts.push(`grid overflow ${group(s.gridOverflow)}`);
  return parts.join(' · ');
}

export function createHud(el: HTMLElement): { update(s: Stats): void; setSound(hint: string): void } {
  el.replaceChildren();
  const stats = document.createElement('div');
  const hints = document.createElement('div');
  hints.className = 'hints';
  hints.textContent = HUD_HINTS;
  const sound = document.createElement('div');
  sound.className = 'hints';
  sound.setAttribute('aria-live', 'polite'); // "click or press a key for sound" is read out
  el.append(stats, hints, sound);
  let last = '',
    lastSound = '';
  return {
    /** Sound status line (audio.ts soundHint); hidden when empty. */
    setSound(hint) {
      if (hint === lastSound) return;
      lastSound = hint;
      sound.textContent = hint;
      sound.hidden = hint === '';
    },
    update(s) {
      const text = formatHud(s);
      if (text !== last) stats.textContent = last = text;
    },
  };
}
