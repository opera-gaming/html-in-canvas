// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Minimal typings for the HTML-in-Canvas proposal's canvas paint hooks (not yet in lib.dom).
interface PaintEvent extends Event {
  changedElements?: Element[];
}

interface HTMLCanvasElement {
  onpaint: ((ev: Event & { changedElements?: Element[] }) => void) | null;
  requestPaint?: () => void;
}
