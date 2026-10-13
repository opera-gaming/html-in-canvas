// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import type { PackedBodies } from '../bodies';
import { MOTION_F32, POSE_F32, PROPS_F32, SHAPE_F32 } from '../bodies';
import { PAGE_SIZE } from '../config';

/** Uniform spatial grid over the page, rebuilt every frame (see sim.ts / grid.wgsl). */
export interface GridBuffers {
  /** atomic<u32> per cell: bodies whose AABB overlaps the cell. */
  cellCount: GPUBuffer;
  /**
   * u32: [0, cells] = cellStart (exclusive prefix sum of cellCount, offsets into the item region), then
   * [cells + 1, cells + 1 + itemCap) = cellItems (body indices). Merged into one buffer so the contacts stage
   * stays within the default 8 storage buffers per stage while also reading occF.
   */
  cellData: GPUBuffer;
  /** atomic<u32> per cell: scatter cursor, seeded from cellStart. */
  cellCursor: GPUBuffer;
  /** atomic<u32> per cell: summed body area × 16 (fixed point), splatted over each body's AABB cells. */
  occupancy: GPUBuffer;
  /** f32 per cell: normalised occupancy (area / cellArea), 3×3 box-blurred. */
  occF: GPUBuffer;
  /** u32 per body: packed cell range x0 | y0<<8 | x1<<16 | y1<<24 from the grid-build pose. */
  cellRange: GPUBuffer;
  dim: number;
  cells: number;
  itemCap: number;
}

export const GRID_CELL_SIZE = 24;
export const GRID_ITEMS_PER_BODY = 6;
/** Item capacity per initial body: small `?max=auto+N` runs still get room for dense piles. */
export const GRID_ITEMS_PER_INITIAL_BODY = 12;

/** Grid item capacity = max(6 × maxBodies, 12 × initialCount). */
export function gridItemCap(maxBodies: number, initialCount: number): number {
  return Math.max(GRID_ITEMS_PER_BODY * maxBodies, GRID_ITEMS_PER_INITIAL_BODY * initialCount);
}

/** GPU storage for the simulation (layout: bodies.ts). The renderer reads `pose[sim.swapIndex()]`. */
export interface SimBuffers {
  pose: [GPUBuffer, GPUBuffer];
  motion: GPUBuffer;
  shape: GPUBuffer;
  props: GPUBuffer;
  wake: GPUBuffer;
  counters: GPUBuffer;
  indirect: GPUBuffer;
  grid: GridBuffers;
  maxBodies: number;
}

/**
 * counters: array<atomic<u32>, 8>
 *   [0] bodyCount: live slots incl. fragments (fracture allocates with atomicAdd, never past maxBodies at frame end)
 *   [1] gridOverflow: grid insertions dropped this frame (item capacity full); reset by clearGrid
 *   [2] awake bodies this frame (finalize); reset by clearGrid — the HUD's "awake" / Stats.active
 *   [3] asleep bodies this frame (finalize); reset by clearGrid
 *   [4] fragmentsMade: successful fractures since boot / reset
 *   [5] fracture snapshot (internal): min(counters[0], bodyCap) taken before the fracture pass, so slots
 *       allocated during the pass aren't processed in the same frame
 *   [6..7] unused
 */
export const COUNTERS_U32 = 8;
const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

function upload(device: GPUDevice, label: string, data: ArrayBufferView, usage = STORAGE): GPUBuffer {
  const buffer = device.createBuffer({ label, size: Math.max(16, data.byteLength), usage, mappedAtCreation: true });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  buffer.unmap();
  return buffer;
}

export function createGridBuffers(
  device: GPUDevice,
  maxBodies: number,
  initialCount: number,
  pageSize: number,
): GridBuffers {
  const dim = Math.ceil(pageSize / GRID_CELL_SIZE);
  if (dim > 255) throw new Error(`grid dim ${dim} does not fit the 8-bit packed cell range`);
  const cells = dim * dim;
  const itemCap = gridItemCap(maxBodies, initialCount);
  const buf = (label: string, u32s: number): GPUBuffer =>
    device.createBuffer({ label, size: Math.max(16, u32s * 4), usage: STORAGE });
  return {
    cellCount: buf('cellCount', cells),
    cellData: buf('cellData', cells + 1 + itemCap),
    cellCursor: buf('cellCursor', cells),
    occupancy: buf('occupancy', cells),
    occF: buf('occF', cells),
    cellRange: buf('cellRange', maxBodies),
    dim,
    cells,
    itemCap,
  };
}

export function createSimBuffers(device: GPUDevice, packed: PackedBodies, maxBodies: number): SimBuffers {
  const check = (arr: Float32Array, per: number, name: string): void => {
    if (arr.length !== maxBodies * per) {
      throw new Error(`createSimBuffers: ${name} sized for ${arr.length / per}, expected ${maxBodies}`);
    }
  };
  check(packed.pose, POSE_F32, 'pose');
  check(packed.motion, MOTION_F32, 'motion');
  check(packed.shape, SHAPE_F32, 'shape');
  check(packed.props, PROPS_F32, 'props');

  const init = initialData(packed, maxBodies);
  return {
    pose: [upload(device, 'pose0', packed.pose), upload(device, 'pose1', packed.pose)],
    motion: upload(device, 'motion', packed.motion),
    shape: upload(device, 'shape', packed.shape),
    props: upload(device, 'props', packed.props),
    wake: upload(device, 'wake', init.wake),
    counters: upload(device, 'counters', init.counters),
    indirect: upload(device, 'indirect', init.indirect, STORAGE | GPUBufferUsage.INDIRECT),
    grid: createGridBuffers(device, maxBodies, packed.count, PAGE_SIZE),
    maxBodies,
  };
}

function initialData(
  packed: PackedBodies,
  maxBodies: number,
): { wake: Uint32Array; counters: Uint32Array; indirect: Uint32Array } {
  const counters = new Uint32Array(COUNTERS_U32);
  counters[0] = packed.count;
  return { wake: new Uint32Array(maxBodies), counters, indirect: new Uint32Array([4, packed.count, 0, 0]) };
}

/**
 * Reset (R): re-uploads the boot-time bodies into BOTH pose buffers plus motion/shape/props/wake, and resets
 * the counters and indirect args. The grid buffers are rebuilt every frame and need nothing. Pair with
 * Sim.reset() so the swap index starts at pose[0] again.
 */
export function resetSimBuffers(device: GPUDevice, sim: SimBuffers, packed: PackedBodies): void {
  const init = initialData(packed, sim.maxBodies);
  const write = (dst: GPUBuffer, data: ArrayBufferView): void =>
    device.queue.writeBuffer(dst, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  write(sim.pose[0], packed.pose);
  write(sim.pose[1], packed.pose);
  write(sim.motion, packed.motion);
  write(sim.shape, packed.shape);
  write(sim.props, packed.props);
  write(sim.wake, init.wake);
  write(sim.counters, init.counters);
  write(sim.indirect, init.indirect);
}
