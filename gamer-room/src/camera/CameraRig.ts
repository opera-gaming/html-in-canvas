// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Pose } from './focusPose';
import { lerpPose } from './tween';

export class CameraRig {
  private from: Pose;
  private to: Pose;
  private parked: Pose;
  private t = 1;
  private onArrive: (() => void) | null = null;
  private sway = true;
  private scratch: Pose = { position: new Vector3(), quaternion: new Quaternion() };

  constructor(
    private camera: PerspectiveCamera,
    overview: Pose,
    private flightMs: number,
    private arc: number,
  ) {
    this.from = clonePose(overview);
    this.to = clonePose(overview);
    this.parked = clonePose(overview);
    camera.position.copy(overview.position);
    camera.quaternion.copy(overview.quaternion);
  }

  get flying(): boolean {
    return this.t < 1;
  }

  flyTo(pose: Pose, onArrive: () => void): void {
    this.from = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() };
    this.to = clonePose(pose);
    this.t = 0;
    this.onArrive = onArrive;
  }

  /** Replace the destination (or the parked pose) without restarting the flight. */
  retarget(pose: Pose): void {
    this.to = clonePose(pose);
    if (!this.flying) this.parked = clonePose(pose);
  }

  setSway(on: boolean): void {
    this.sway = on;
  }

  update(dtMs: number, nowMs: number): void {
    if (this.flying) {
      this.t = Math.min(1, this.t + dtMs / this.flightMs);
      lerpPose(this.from, this.to, this.t, this.arc, this.scratch);
      this.camera.position.copy(this.scratch.position);
      this.camera.quaternion.copy(this.scratch.quaternion);
      if (this.t >= 1) {
        this.parked = clonePose(this.to);
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      }
      return;
    }
    this.camera.position.copy(this.parked.position);
    this.camera.quaternion.copy(this.parked.quaternion);
    if (this.sway) {
      const s = nowMs * 0.001;
      const offset = new Vector3(Math.sin(s * 0.37) * 0.02, Math.sin(s * 0.53) * 0.015, 0).applyQuaternion(
        this.parked.quaternion,
      );
      this.camera.position.add(offset);
    }
  }
}

function clonePose(p: Pose): Pose {
  return { position: p.position.clone(), quaternion: p.quaternion.clone() };
}
