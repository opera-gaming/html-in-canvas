// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Loading veil (DOM overlay, styled in index.html): covers the page while it loads, then lifts by itself and
// the intro starts. Nothing to click: the engine sound starts by itself, or on the first key press or click where
// autoplay is blocked (audio.ts).

export interface Splash {
  /** The page is ready: the veil lifts. */
  ready(): void;
}

/** Builds the veil inside `el` and shows it ("Loading the page…"). */
export function createSplash(el: HTMLElement): Splash {
  el.replaceChildren();
  const card = document.createElement('div');
  card.className = 'sp-card';
  const badge = document.createElement('div');
  badge.className = 'sp-badge';
  badge.textContent = 'Opera · HTML in Canvas';
  const title = document.createElement('h1');
  title.className = 'sp-title';
  title.textContent = 'Webpage Bulldozer';
  const lede = document.createElement('p');
  lede.className = 'sp-lede';
  lede.textContent = 'Every word on this page is real HTML, drawn into a WebGPU canvas. Drive through it.';
  const status = document.createElement('p');
  status.className = 'sp-status';
  status.textContent = 'Loading the page…';
  card.append(badge, title, lede, status);
  el.append(card);
  el.hidden = false;

  return {
    ready() {
      el.hidden = true;
    },
  };
}
