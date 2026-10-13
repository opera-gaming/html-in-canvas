// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** Whether a fatal panel is already showing (the first one wins; later errors only go to the console). */
export function fatalShown(): boolean {
  return document.getElementById('fatal') !== null;
}

/**
 * Replace the view with a full-viewport error panel. Text nodes only. Keeps the FIRST message: a later call (often
 * a consequence of the first failure) returns false and leaves the panel as it is.
 */
export function showFatal(title: string, lines: string[]): boolean {
  if (fatalShown()) return false;
  const panel = document.createElement('div');
  panel.id = 'fatal';
  Object.assign(panel.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '1000',
    background: '#111',
    color: '#eee',
    font: '16px/1.5 system-ui, sans-serif',
    padding: '48px',
    overflow: 'auto',
  });
  const h1 = document.createElement('h1');
  h1.textContent = title;
  panel.appendChild(h1);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    panel.appendChild(p);
  }
  document.body.appendChild(panel);
  return true;
}
