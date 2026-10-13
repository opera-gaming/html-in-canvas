// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { PointLight, RectAreaLight, SpotLight, Vector3 } from 'three';
import { createDynamicLights } from '../src/scene/dynamicLights';

const base = {
  position: [1, 2, 3] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  color: [1, 0.5, 0.25] as [number, number, number],
  energy: 10,
};

describe('createDynamicLights', () => {
  it('creates the right three.js light per Blender type', () => {
    const { lights } = createDynamicLights([
      { name: 'Dyn_A', type: 'POINT', ...base },
      { name: 'Dyn_B', type: 'AREA', size: [0.5, 0.25], ...base },
      { name: 'Dyn_C', type: 'SPOT', spotAngle: 1.0, ...base },
    ]);
    expect(lights[0]).toBeInstanceOf(PointLight);
    expect(lights[1]).toBeInstanceOf(RectAreaLight);
    expect((lights[1] as RectAreaLight).width).toBeCloseTo(0.5);
    expect(lights[2]).toBeInstanceOf(SpotLight);
    expect((lights[2] as SpotLight).angle).toBeCloseTo(0.5);
    expect(lights[0]!.position.toArray()).toEqual([1, 2, 3]);
  });
  it('pulses intensity around the base energy', () => {
    const { lights, update } = createDynamicLights([{ name: 'Dyn_A', type: 'POINT', dynamic: true, ...base }]);
    const i0 = lights[0]!.intensity;
    update(0);
    const a = lights[0]!.intensity;
    update(250);
    const b = lights[0]!.intensity;
    expect(a).not.toBeCloseTo(b, 3);
    expect(Math.abs(a - i0) / i0).toBeLessThan(0.6);
  });
  it('aims a spot light along its own -Z axis, so the exported rotation drives it', () => {
    const { lights } = createDynamicLights([
      { name: 'Dyn_S', type: 'SPOT', spotAngle: 1.0, ...base, quaternion: [0, 0.7071068, 0, 0.7071068] },
    ]);
    const spot = lights[0] as SpotLight;
    spot.updateMatrixWorld(true);
    const dir = spot.target.getWorldPosition(new Vector3()).sub(spot.getWorldPosition(new Vector3()));
    expect(dir.x).toBeCloseTo(-1);
    expect(dir.y).toBeCloseTo(0);
    expect(dir.z).toBeCloseTo(0);
  });
  it('keeps non-dynamic lights at a constant intensity and colour', () => {
    const { lights, update } = createDynamicLights([{ name: 'Point.001', type: 'POINT', dynamic: false, ...base }]);
    const i0 = lights[0]!.intensity;
    const c0 = lights[0]!.color.getHex();
    update(0);
    update(250);
    update(1300);
    expect(lights[0]!.intensity).toBe(i0);
    expect(lights[0]!.color.getHex()).toBe(c0);
  });
  it('multiplies every computed intensity by scale', () => {
    const one = createDynamicLights([
      { name: 'P', type: 'POINT', ...base },
      { name: 'A', type: 'AREA', ...base },
    ]);
    const four = createDynamicLights(
      [
        { name: 'P', type: 'POINT', ...base },
        { name: 'A', type: 'AREA', ...base },
      ],
      4,
    );
    expect(one.lights[0]!.intensity).toBeCloseTo(0.5);
    expect(four.lights[0]!.intensity).toBeCloseTo(2);
    expect(four.lights[1]!.intensity).toBeCloseTo(one.lights[1]!.intensity * 4);
  });
  it('lets overrides replace intensity and colour by name, also as the pulse base', () => {
    const dyn = createDynamicLights(
      [
        { name: 'Point.005', type: 'POINT', ...base },
        { name: 'Dyn_X', type: 'POINT', dynamic: true, ...base },
        { name: 'Other', type: 'POINT', ...base },
      ],
      4,
    );
    dyn.applyOverrides({ 'Point.005': { intensity: 7, color: 0x00ff00 }, Dyn_X: { intensity: 1 } });
    expect(dyn.lights[0]!.intensity).toBe(7);
    expect(dyn.lights[0]!.color.getHex()).toBe(0x00ff00);
    expect(dyn.lights[2]!.intensity).toBeCloseTo(2);
    dyn.update(1250); // sin peak at 0.2 Hz
    expect(dyn.lights[0]!.intensity).toBe(7);
    expect(dyn.lights[1]!.intensity).toBeCloseTo(1.15, 2);
  });
});
