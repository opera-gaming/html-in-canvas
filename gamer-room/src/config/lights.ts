// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** Faint ambient fallback only; the room is lit by the exported Blender lights. */
export const fillLight = { skyColor: 0x8a84a8, groundColor: 0x2a1c14, intensity: 0.15 };
/** Fill intensity once lightmaps are present: the bake already carries the bounce light. */
export const fillLightBaked = 0;

/**
 * Global multiplier on every exported light. Blender watts map only loosely onto three.js
 * units (see intensityFor in scene/dynamicLights.ts), so this is the one knob to turn first.
 */
export const lightScale = 3;

/** Per-light tweaks by Blender object name: `intensity` replaces the computed value, `color` sets hex. */
export const lightOverrides: Record<string, { intensity?: number; color?: number }> = {
  // Outside the room; without shadow maps they flood the walls.
  'Light.003': { intensity: 0 },
  Area: { intensity: 0 },
};

/** Hue drift is opt-in per light (via lightAnimations); by default lights only pulse. */
export const defaultLightAnimation = { hueDrift: 0, pulse: 0.15, pulseHz: 0.2 };
/** Per-light animation overrides keyed by the Blender object name (only Dyn_* lights animate). */
export const lightAnimations: Record<string, Partial<typeof defaultLightAnimation>> = {};

/** Opt-in emissive hue drift by material name, in hue cycles per minute (applied by scene/emissiveHue.ts). */
export const emissiveHue: Record<string, { hueDrift: number }> = {};
