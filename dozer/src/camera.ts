// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/**
 * World → clip transform as a column-major mat3x3, padded to 12 floats for WGSL `mat3x3f`
 * (each column is a vec3 with 16-byte stride). World y points down, clip y points up.
 */
export function viewMatrix(
  center: [number, number],
  viewportCss: [number, number],
  viewWidthWorld: number,
): Float32Array {
  const [cx, cy] = center;
  const [vw, vh] = viewportCss;
  const sx = 2 / viewWidthWorld;
  const sy = -2 / (viewWidthWorld * (vh / vw));
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, -cx * sx, -cy * sy, 1, 0]);
}

/**
 * World width of the view: `preferred`, but never so wide (or, on tall viewports, so tall)
 * that the view is larger than the page.
 */
export function viewWidthFor(viewportCss: [number, number], preferred: number, pageSize: number): number {
  const [vw, vh] = viewportCss;
  return Math.min(preferred, pageSize, (pageSize * vw) / vh);
}

/** Clamps the camera centre so a view of `viewSize` stays inside the page (centred when it can't). */
export function clampCamera(center: [number, number], viewSize: [number, number], pageSize: number): [number, number] {
  const axis = (c: number, size: number): number =>
    size >= pageSize ? pageSize / 2 : Math.min(pageSize - size / 2, Math.max(size / 2, c));
  return [axis(center[0], viewSize[0]), axis(center[1], viewSize[1])];
}
