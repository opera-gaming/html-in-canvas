// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { Camera, Mesh, Raycaster, Vector2 } from 'three';

export class HoverPicker {
  private ray = new Raycaster();
  private ndc = new Vector2();
  constructor(
    private camera: Camera,
    private meshes: Mesh[],
  ) {}

  /** nx, ny in normalized device coordinates (-1..1). Returns the hovered screen id. */
  pick(nx: number, ny: number): string | null {
    this.ndc.set(nx, ny);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    return hit ? (hit.object.userData.screenId as string) : null;
  }
}
