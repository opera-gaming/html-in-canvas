// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// On-demand CPU copy of the body buffers for picking (interact.ts pickBody): the live slot count plus each live slot's
// pose, shape and props, copied into ONE persistent staging buffer with a single mapAsync in flight. Never part of the
// simulation loop; a click waits a frame or two for it, hover reuses a recent copy.
import { POSE_F32, PROPS_F32, SHAPE_F32 } from '../bodies';
import { COUNTERS_U32, type SimBuffers } from './buffers';
import type { BodySnapshot } from '../interact';

export interface BodyReader {
  /**
   * A snapshot taken at or after `notBefore` (performance.now() ms; default: now, i.e. a fresh copy). While a copy is
   * in flight, callers share it, and a caller that needs a newer one waits for the next.
   */
  read(notBefore?: number): Promise<BodySnapshot & { time: number }>;
  /** The latest finished snapshot (or null), without starting a copy. */
  latest(): (BodySnapshot & { time: number }) | null;
}

export function createBodyReader(
  device: GPUDevice,
  sim: SimBuffers,
  poseIndex: () => 0 | 1,
  liveHint: () => number,
): BodyReader {
  const cap = sim.maxBodies;
  const counterBytes = COUNTERS_U32 * 4;
  const per = (POSE_F32 + SHAPE_F32 + PROPS_F32) * 4;
  const staging = device.createBuffer({
    label: 'pick readback',
    size: counterBytes + cap * per,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let latest: (BodySnapshot & { time: number }) | null = null;
  let inFlight: Promise<BodySnapshot & { time: number }> | null = null;

  const copy = (): Promise<BodySnapshot & { time: number }> => {
    // Copy the live slots plus some headroom for fragments made since the hint (the HUD stats, ≤ 100 ms old).
    const n = Math.min(cap, Math.max(1, liveHint() + 512));
    const time = performance.now();
    const enc = device.createCommandEncoder({ label: 'pick readback' });
    const poseOff = counterBytes,
      shapeOff = poseOff + n * POSE_F32 * 4,
      propsOff = shapeOff + n * SHAPE_F32 * 4;
    enc.copyBufferToBuffer(sim.counters, 0, staging, 0, counterBytes);
    enc.copyBufferToBuffer(sim.pose[poseIndex()], 0, staging, poseOff, n * POSE_F32 * 4);
    enc.copyBufferToBuffer(sim.shape, 0, staging, shapeOff, n * SHAPE_F32 * 4);
    enc.copyBufferToBuffer(sim.props, 0, staging, propsOff, n * PROPS_F32 * 4);
    device.queue.submit([enc.finish()]);
    return staging.mapAsync(GPUMapMode.READ, 0, propsOff + n * PROPS_F32 * 4).then(() => {
      const data = staging.getMappedRange(0, propsOff + n * PROPS_F32 * 4).slice(0);
      staging.unmap();
      const count = Math.min(new Uint32Array(data, 0, 1)[0]!, n);
      latest = {
        count,
        pose: new Float32Array(data, poseOff, n * POSE_F32),
        shape: new Float32Array(data, shapeOff, n * SHAPE_F32),
        props: new Float32Array(data, propsOff, n * PROPS_F32),
        time,
      };
      return latest;
    });
  };

  const read = async (notBefore = performance.now()): Promise<BodySnapshot & { time: number }> => {
    for (;;) {
      if (latest && latest.time >= notBefore) return latest;
      if (!inFlight) {
        inFlight = copy().finally(() => {
          inFlight = null;
        });
      }
      await inFlight; // a failed copy rejects the caller instead of looping
    }
  };
  return { read, latest: () => latest };
}
