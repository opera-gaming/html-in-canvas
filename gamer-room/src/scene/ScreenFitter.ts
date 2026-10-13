// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { BufferGeometry, Mesh, Vector2, Vector3 } from 'three';

export interface ScreenRect {
  center: Vector3;
  right: Vector3;
  up: Vector3;
  normal: Vector3;
  width: number;
  height: number;
  curved: boolean;
}

export function normalizeScreenUVs(geometry: BufferGeometry, flipV: boolean) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return null;
  let uMin = Infinity,
    uMax = -Infinity,
    vMin = Infinity,
    vMax = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i),
      v = uv.getY(i);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const du = uMax - uMin || 1,
    dv = vMax - vMin || 1;
  for (let i = 0; i < uv.count; i++) {
    const u = (uv.getX(i) - uMin) / du;
    let v = (uv.getY(i) - vMin) / dv;
    if (flipV) v = 1 - v;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return { uMin, uMax, vMin, vMax };
}

const CORNERS: [Vector2, 'bl' | 'br' | 'tl' | 'tr'][] = [
  [new Vector2(0, 0), 'bl'],
  [new Vector2(1, 0), 'br'],
  [new Vector2(0, 1), 'tl'],
  [new Vector2(1, 1), 'tr'],
];

/** Oriented rectangle from a quad-like mesh using its (normalised) UVs. */
export function fitScreen(mesh: Mesh, facing?: Vector3): ScreenRect | null {
  const pos = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  if (!pos || !uv || pos.count < 4) return null;

  const found = {} as Record<'bl' | 'br' | 'tl' | 'tr', Vector3>;
  const uvTmp = new Vector2();
  for (const [target, key] of CORNERS) {
    let best = Infinity,
      bestIndex = -1;
    for (let i = 0; i < uv.count; i++) {
      uvTmp.set(uv.getX(i), uv.getY(i));
      const d = uvTmp.distanceToSquared(target);
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    if (best > 0.01) return null;
    found[key] = new Vector3().fromBufferAttribute(pos, bestIndex).applyMatrix4(mesh.matrixWorld);
  }
  const { bl, br, tl, tr } = found;

  const rightV = new Vector3().subVectors(br, bl);
  const upV = new Vector3().subVectors(tl, bl);
  const normal = new Vector3().crossVectors(rightV, upV);
  if (normal.lengthSq() < 1e-12) return null;
  normal.normalize();
  const width = rightV.length();
  const height = upV.length();

  // The four corners must be coplanar (a curved screen still has a flat chord rectangle).
  if (Math.abs(new Vector3().subVectors(tr, bl).dot(normal)) > 0.01 * width) return null;

  // Curvature: any vertex off the corner plane by more than 1% of the width.
  let maxDev = 0;
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    maxDev = Math.max(maxDev, Math.abs(p.sub(bl).dot(normal)));
  }
  const curved = maxDev > 0.01 * width;

  const right = rightV.clone().normalize();
  const up = upV.clone().normalize();
  const center = new Vector3().add(bl).add(br).add(tl).add(tr).multiplyScalar(0.25);

  if (facing && new Vector3().subVectors(facing, center).dot(normal) < 0) {
    normal.negate();
    right.negate();
  }
  return { center, right, up, normal, width, height, curved };
}
