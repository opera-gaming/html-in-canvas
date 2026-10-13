// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export const cameraConfig = {
  fov: 55,
  near: 0.05,
  far: 60,
  /** Fallback overview pose, standing inside the room. */
  overview: {
    position: [-1.6, 2.3, 3.2] as [number, number, number],
    lookAt: [1.1, 1.0, -0.1] as [number, number, number],
  },
  /** Fallback flight duration, blend into an authored path, arc lift (m), viewport fill. */
  flightMs: 1400,
  blendMs: 400,
  arc: 0.15,
  fill: 0.8,
};
