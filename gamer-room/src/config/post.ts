// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export const postConfig = {
  ao: false, // the lightmaps already carry contact shadowing; N8AO costs a scene re-render
  bloom: { threshold: 1.0, intensity: 0.9, radius: 0.7 },
  // In-focus range as a fraction of the focus distance, like a real lens: deep far away, shallow up close.
  dof: { focusRangeRatio: 0.3, bokehScale: 2.5 },
  vignette: { offset: 0.35, darkness: 0.55 },
  aberration: 0.0015,
};
