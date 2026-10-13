// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Minimal typings for the HTML-in-Canvas proposal's canvas paint hooks (not yet in lib.dom). See src/capture.ts.
interface PaintEvent extends Event {
  changedElements?: Element[];
}

interface HTMLCanvasElement {
  onpaint: ((ev: Event & { changedElements?: Element[] }) => void) | null;
  requestPaint?: () => void;
}

interface GPUCopyElementImageSource {
  source: Element;
  sx?: number;
  sy?: number;
  swidth?: number;
  sheight?: number;
}
interface GPUCopyElementImageDestination {
  destination: GPUCopyExternalImageDestInfo;
  width?: number;
  height?: number;
}
interface GPUDrawElementImageSource {
  source: Element;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}
interface GPUDrawElementImageDestination extends GPUCopyExternalImageDestInfo {
  size?: GPUExtent3D;
}

interface GPUQueue {
  copyElementImageToTexture?: (source: GPUCopyElementImageSource, destination: GPUCopyElementImageDestination) => void;
  drawElementImageToTexture?: (source: GPUDrawElementImageSource, destination: GPUDrawElementImageDestination) => void;
}
interface CanvasRenderingContext2D {
  drawElementImage?: (...args: unknown[]) => unknown;
}
