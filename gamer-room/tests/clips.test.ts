// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { AnimationClip, Group, PerspectiveCamera, Object3D, VectorKeyframeTrack, QuaternionKeyframeTrack } from 'three';
import { findCameraClips, clipPoseAt } from '../src/camera/clips';

function camNode(name: string, withOrientationChild = false) {
  const node = new Object3D();
  node.name = name;
  const cam = new PerspectiveCamera(40);
  cam.name = withOrientationChild ? `${name}_Orientation` : name;
  if (withOrientationChild) node.add(cam);
  else return cam;
  return node;
}

function clipFor(nodeName: string, name = nodeName) {
  return new AnimationClip(name, 2, [
    new VectorKeyframeTrack(`${nodeName}.position`, [0, 2], [0, 0, 0, 5, 0, 0]),
    new QuaternionKeyframeTrack(`${nodeName}.quaternion`, [0, 2], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

describe('findCameraClips', () => {
  it('matches Cam_Idle and Cam_<id> nodes to the clips that animate them', () => {
    const root = new Group();
    root.add(camNode('Cam_Idle'), camNode('Cam_Arcade', true), camNode('Camera'));
    const clips = [clipFor('Cam_Idle', 'IdleAction'), clipFor('Cam_Arcade', 'ArcadeAction')];
    const r = findCameraClips(root, clips);
    expect(r.idle?.clip.name).toBe('IdleAction');
    expect([...r.byScreen.keys()]).toEqual(['arcade']);
    expect(r.byScreen.get('arcade')!.camera.fov).toBe(40); // camera found as descendant
  });
  it('strips the sanitised Blender duplicate suffix from the id', () => {
    const root = new Group();
    root.add(camNode('Cam_Arcade001', true));
    const r = findCameraClips(root, [clipFor('Cam_Arcade001')]);
    expect([...r.byScreen.keys()]).toEqual(['arcade']);
  });
  it('ignores Cam_ nodes without an animation', () => {
    const root = new Group();
    root.add(camNode('Cam_MonL'));
    expect(findCameraClips(root, []).byScreen.size).toBe(0);
  });
});

describe('clipPoseAt', () => {
  it('samples the node pose at a time without leaving the mixer running', () => {
    const root = new Group();
    const node = camNode('Cam_Idle');
    root.add(node);
    const cc = findCameraClips(root, [clipFor('Cam_Idle')]).idle!;
    const p = clipPoseAt(root, cc, 1);
    expect(p.position.x).toBeCloseTo(2.5);
    expect(p.fov).toBe(40);
  });
});
