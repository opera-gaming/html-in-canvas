// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import {
  AnimationClip,
  AnimationMixer,
  Object3D,
  PerspectiveCamera,
  PropertyBinding,
  Quaternion,
  Vector3,
} from 'three';
import type { Pose } from './focusPose';

export interface CameraClip {
  name: string;
  node: Object3D;
  camera: PerspectiveCamera;
  clip: AnimationClip;
}
export interface CameraClips {
  idle: CameraClip | null;
  byScreen: Map<string, CameraClip>;
}

const CAM_RE = /^Cam_([A-Za-z0-9]+)(?:\.\d+)?$/;

function findCamera(node: Object3D): PerspectiveCamera | null {
  let found: PerspectiveCamera | null = null;
  node.traverse((o) => {
    if (!found && (o as PerspectiveCamera).isPerspectiveCamera) found = o as PerspectiveCamera;
  });
  return found;
}

/** Maps Cam_Idle / Cam_<id> nodes to the AnimationClip whose tracks target them. */
export function findCameraClips(root: Object3D, animations: AnimationClip[]): CameraClips {
  const clipByNode = new Map<string, AnimationClip>();
  for (const clip of animations) {
    for (const track of clip.tracks) {
      const nodeName = PropertyBinding.parseTrackName(track.name).nodeName;
      if (nodeName && !clipByNode.has(nodeName)) clipByNode.set(nodeName, clip);
    }
  }
  const result: CameraClips = { idle: null, byScreen: new Map() };
  root.traverse((node) => {
    const m = CAM_RE.exec(node.name);
    if (!m || !m[1]) return;
    const clip = clipByNode.get(node.name);
    const camera = findCamera(node);
    if (!clip || !camera) return;
    const cc: CameraClip = { name: node.name, node, camera, clip };
    const id = (m[1].replace(/\d{3}$/, '') || m[1]).toLowerCase();
    if (id === 'idle') result.idle = cc;
    else result.byScreen.set(id, cc);
  });
  return result;
}

/** World pose and fov of a camera clip at `time`, sampled with a throwaway mixer. */
export function clipPoseAt(root: Object3D, cc: CameraClip, time: number): Pose & { fov: number } {
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(cc.clip, cc.node);
  action.play();
  mixer.setTime(time);
  root.updateMatrixWorld(true);
  const pose = { position: new Vector3(), quaternion: new Quaternion(), fov: cc.camera.fov };
  cc.camera.getWorldPosition(pose.position);
  cc.camera.getWorldQuaternion(pose.quaternion);
  action.stop();
  mixer.uncacheRoot(root);
  return pose;
}
