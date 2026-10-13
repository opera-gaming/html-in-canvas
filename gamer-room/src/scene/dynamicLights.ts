// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { Color, Light, PointLight, RectAreaLight, SpotLight, DirectionalLight } from 'three';
import { defaultLightAnimation, lightAnimations } from '../config/lights';

export interface DynLight {
  name: string;
  type: 'POINT' | 'SPOT' | 'AREA' | 'SUN';
  position: [number, number, number];
  quaternion: [number, number, number, number];
  color: [number, number, number];
  energy: number;
  size?: [number, number];
  spotAngle?: number;
  /** True for Blender Dyn_* lights: only these pulse / drift. Others stay at their base intensity and colour. */
  dynamic?: boolean;
}

export type LightOverrides = Record<string, { intensity?: number; color?: number }>;

/** Blender watts → three.js intensity (rough): points/spots /20, area /10, sun as-is. */
function intensityFor(d: DynLight): number {
  switch (d.type) {
    case 'POINT':
      return d.energy / 20;
    case 'SPOT':
      return d.energy / 20;
    case 'AREA':
      return d.energy / 10;
    case 'SUN':
      return d.energy;
  }
}

/** Build three.js lights from the exported defs. `scale` multiplies every computed intensity. */
export function createDynamicLights(defs: DynLight[], scale = 1) {
  const entries = defs.map((d) => {
    const intensity = intensityFor(d) * scale;
    let light: Light;
    if (d.type === 'AREA')
      light = new RectAreaLight(new Color(...d.color), intensity, d.size?.[0] ?? 1, d.size?.[1] ?? 1);
    else if (d.type === 'SPOT') {
      const s = new SpotLight(new Color(...d.color), intensity, 10, (d.spotAngle ?? 1) / 2, 0.3, 2);
      light = s;
    } else if (d.type === 'SUN') light = new DirectionalLight(new Color(...d.color), intensity);
    else light = new PointLight(new Color(...d.color), intensity, 10, 2);
    light.name = d.name;
    light.position.set(...d.position);
    light.quaternion.set(...d.quaternion);
    if (light instanceof SpotLight || light instanceof DirectionalLight) {
      // Aim along the light's own -Z (Blender's light forward after the Y-up export), not at the world origin.
      light.add(light.target);
      light.target.position.set(0, 0, -1);
    }
    const anim = { ...defaultLightAnimation, ...(lightAnimations[d.name] ?? {}) };
    const baseHsl = { h: 0, s: 0, l: 0 };
    light.color.getHSL(baseHsl);
    return { light, base: intensity, anim, baseHsl, dynamic: d.dynamic === true };
  });
  return {
    lights: entries.map((e) => e.light),
    /** Per-name overrides: `intensity` replaces the computed value, `color` sets the hex colour. */
    applyOverrides(overrides: LightOverrides) {
      for (const e of entries) {
        const o = overrides[e.light.name];
        if (!o) continue;
        if (o.intensity !== undefined) {
          e.base = o.intensity;
          e.light.intensity = o.intensity;
        }
        if (o.color !== undefined) {
          e.light.color.setHex(o.color);
          e.light.color.getHSL(e.baseHsl);
        }
      }
    },
    update(nowMs: number) {
      const t = nowMs / 1000;
      for (const e of entries) {
        if (!e.dynamic) continue;
        e.light.intensity = e.base * (1 + e.anim.pulse * Math.sin(2 * Math.PI * e.anim.pulseHz * t));
        const h = (e.baseHsl.h + (e.anim.hueDrift * t) / 60) % 1;
        e.light.color.setHSL(h, e.baseHsl.s, e.baseHsl.l);
      }
    },
  };
}

export async function loadDynamicLights(url: string): Promise<DynLight[]> {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const body: unknown = await r.json();
    return Array.isArray(body) ? (body as DynLight[]) : [];
  } catch {
    return [];
  }
}
