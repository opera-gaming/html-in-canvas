// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import {
  AnimationAction,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import type { CameraClip, CameraClips } from './clips';
import { clipPoseAt } from './clips';
import type { Pose } from './focusPose';
import type { CameraRig } from './CameraRig';
import { lerpPose } from './tween';

type Phase =
  | { kind: 'idle' }
  | { kind: 'blend'; from: Pose; to: Pose; t: number; next: CameraClip; onArrive: () => void }
  | { kind: 'fly'; cc: CameraClip; onArrive: () => void }
  | { kind: 'parked'; cc: CameraClip }
  | { kind: 'reverse'; cc: CameraClip; onArrive: () => void }
  | { kind: 'fallback' };

export class CameraDirector {
  private mixer: AnimationMixer;
  private idleAction: AnimationAction | null = null;
  private actions = new Map<string, AnimationAction>();
  private phase: Phase;
  private scratch: Pose = { position: new Vector3(), quaternion: new Quaternion() };
  /** False holds the idle path still (prefers-reduced-motion). */
  idleMotion = true;

  constructor(
    private camera: PerspectiveCamera,
    private root: Object3D,
    private clips: CameraClips,
    private fallback: CameraRig,
    private fallbackPoseFor: (id: string | null) => Pose,
    private blendMs: number,
  ) {
    this.mixer = new AnimationMixer(root);
    if (clips.idle) {
      this.idleAction = this.mixer.clipAction(clips.idle.clip, clips.idle.node);
      this.idleAction.setLoop(LoopRepeat, Infinity).play();
      this.phase = { kind: 'idle' };
    } else {
      this.phase = { kind: 'fallback' };
    }
  }

  private actionFor(cc: CameraClip): AnimationAction {
    let a = this.actions.get(cc.name);
    if (!a) {
      a = this.mixer.clipAction(cc.clip, cc.node);
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = true;
      this.actions.set(cc.name, a);
    }
    return a;
  }

  flyTo(id: string, onArrive: () => void): void {
    const cc = this.clips.byScreen.get(id);
    if (!cc || !this.clips.idle) {
      this.phase = { kind: 'fallback' };
      this.fallback.flyTo(this.fallbackPoseFor(id), onArrive);
      return;
    }
    const from: Pose = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() };
    const to = clipPoseAt(this.root, cc, 0);
    this.idleAction?.stop();
    this.phase = { kind: 'blend', from, to, t: 0, next: cc, onArrive };
  }

  flyBack(onArrive: () => void): void {
    if (this.phase.kind === 'parked') {
      const { cc } = this.phase;
      const a = this.actionFor(cc);
      a.paused = false;
      a.timeScale = -1;
      a.time = cc.clip.duration;
      a.play();
      this.phase = { kind: 'reverse', cc, onArrive };
      return;
    }
    this.phase = { kind: 'fallback' };
    const home = this.clips.idle ? clipPoseAt(this.root, this.clips.idle, 0) : this.fallbackPoseFor(null);
    this.fallback.flyTo(home, () => {
      if (this.idleAction) {
        this.idleAction.reset().play();
        this.phase = { kind: 'idle' };
      }
      onArrive();
    });
  }

  retarget(id: string | null): void {
    if (this.phase.kind === 'fallback') this.fallback.retarget(this.fallbackPoseFor(id));
  }

  update(dtMs: number, nowMs: number): void {
    const dt = dtMs / 1000;
    switch (this.phase.kind) {
      case 'fallback':
        this.fallback.update(dtMs, nowMs);
        return;
      case 'idle':
        this.mixer.update(this.idleMotion ? dt : 0);
        this.copyFrom(this.clips.idle!);
        return;
      case 'blend': {
        const ph = this.phase;
        ph.t = this.blendMs <= 0 ? 1 : Math.min(1, ph.t + dtMs / this.blendMs);
        lerpPose(ph.from, ph.to, ph.t, 0, this.scratch);
        this.camera.position.copy(this.scratch.position);
        this.camera.quaternion.copy(this.scratch.quaternion);
        if (ph.t >= 1) {
          const a = this.actionFor(ph.next);
          a.reset();
          a.timeScale = 1;
          a.paused = false;
          a.play();
          this.phase = { kind: 'fly', cc: ph.next, onArrive: ph.onArrive };
        }
        return;
      }
      case 'fly': {
        const ph = this.phase;
        const a = this.actionFor(ph.cc);
        this.mixer.update(dt);
        this.copyFrom(ph.cc);
        if (a.time >= ph.cc.clip.duration - 1e-4 || a.paused) {
          this.phase = { kind: 'parked', cc: ph.cc };
          ph.onArrive();
        }
        return;
      }
      case 'parked':
        this.copyFrom(this.phase.cc);
        return;
      case 'reverse': {
        const ph = this.phase;
        const a = this.actionFor(ph.cc);
        this.mixer.update(dt);
        this.copyFrom(ph.cc);
        if (a.time <= 1e-4 || a.paused) {
          a.stop();
          if (this.idleAction) {
            this.idleAction.reset().play();
            this.phase = { kind: 'idle' };
          } else this.phase = { kind: 'fallback' };
          ph.onArrive();
        }
        return;
      }
    }
  }

  /** Copy the clip camera's world pose and fov to the render camera. */
  private copyFrom(cc: CameraClip): void {
    // Only the animated camera's chain needs fresh matrices, not the whole room.
    cc.camera.updateWorldMatrix(true, false);
    cc.camera.getWorldPosition(this.camera.position);
    cc.camera.getWorldQuaternion(this.camera.quaternion);
    if (Math.abs(this.camera.fov - cc.camera.fov) > 1e-3) {
      this.camera.fov = cc.camera.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
