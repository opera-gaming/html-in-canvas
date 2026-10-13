// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export function averageColor(rgba: Uint8Array): [number, number, number] {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return [0, 0, 0];
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < n; i++) {
    r += rgba[i * 4]!;
    g += rgba[i * 4 + 1]!;
    b += rgba[i * 4 + 2]!;
  }
  return [r / n / 255, g / n / 255, b / n / 255];
}
