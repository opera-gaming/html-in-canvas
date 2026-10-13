// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// GPU simulation driver: encodes one fixed simulation step (main.ts runs FIXED_DT steps, stepper.ts) of compute
// passes (no CPU readback). TUNING is per second, independent of the step size.
//
//   clearGrid (+clearOcc) → integrate → dozerPre → countCells (+accumOcc) → resolveOcc → scanCells → scatter
//   → contacts × iterations (ping-pong) → spread → dozerPost → finalize (+height, scoop)
//   → fractureSnapshot → fracture → writeIndirect (the GPU owns the draw instance count)
//
// Velocity model: only integrate (damping, friction) and the dozer (blade/wing push: the pushing part of the dozer
// surface velocity along the contact normal) change velocity. Contacts, spread and push-out move positions only, each
// capped per step (contactStep, pushBudgetK/pushMargin), so piles transmit a push without springing or jumping.
//
// integrate / dozer / grid / finalize work in place on pose[cur]; each contact iteration reads pose[cur] and
// writes pose[1 - cur], then cur flips. After step(), pose[swapIndex()] holds the final pose for this frame
// (and is next frame's starting pose).
import commonWgsl from '../shaders/common.wgsl?raw';
import simCommonWgsl from '../shaders/simcommon.wgsl?raw';
import integrateWgsl from '../shaders/integrate.wgsl?raw';
import gridWgsl from '../shaders/grid.wgsl?raw';
import contactsWgsl from '../shaders/contacts.wgsl?raw';
import dozerWgsl from '../shaders/dozer.wgsl?raw';
import finalizeWgsl from '../shaders/finalize.wgsl?raw';
import pileWgsl from '../shaders/pile.wgsl?raw';
import fractureWgsl from '../shaders/fracture.wgsl?raw';
import type { SimBuffers } from './buffers';
import { COUNTERS_U32, GRID_CELL_SIZE } from './buffers';
import type { Stats } from '../hud';
import type { Config } from '../config';
import { PAGE_SIZE } from '../config';
import type { DozerState } from '../dozer';
import type { V2 } from '../geom';
import type { Prof } from './prof';

/** Simulation tuning, written into SimU.tuning (layout documented in simcommon.wgsl). Rates are per second. */
export const TUNING = {
  /** Linear velocity damping, 1/s. High so the heap stays at the blade instead of dissolving sideways. */
  linDamp: 8.0,
  /** Ground friction, px/s²: a constant deceleration so pushed words stop within ~30 px of leaving the blade. */
  friction: 1200,
  /**
   * Body-body (and spread) correction cap, px per contact iteration. Low, so the heap ahead of the blade compresses
   * into stacks instead of expanding after the dozer stops.
   */
  contactStep: 1,
  /** Per-iteration correction cap as a fraction of the thinnest body in contact (thin words never jump past each other). */
  contactFrac: 0.5,
  /** Angular velocity damping, 1/s. */
  angDamp: 8.0,
  /** Jacobi relaxation factor applied to the averaged contact correction. */
  relax: 0.4,
  /**
   * Allowed penetration = slopBase × min(body thickness of the pair). Word boxes on adjacent lines overlap by up to
   * ~19% of their thickness at rest (glyph box > line height); a smaller slop makes woken paragraphs push themselves
   * apart in a chain.
   */
  slopBase: 0.35,
  /** Speed (px/s) below which a body counts toward sleeping. */
  sleepSpeed: 4,
  /** Seconds a body must stay slow before it sleeps. */
  sleepTime: 1.5,
  /** Penetration beyond the slop (px) into a sleeping body that wakes it. */
  wakeDepth: 0.5,
  /**
   * dozerPre push-out budget per step, as a multiple of the distance the blade surface at the body moved this step
   * (plus pushMargin): clears any body the blade overran without making anything jump.
   */
  pushBudgetK: 1.5,
  /**
   * Constant part of the dozerPre budget, and the whole dozerPost budget (px per step): after the contact iterations
   * a body can only have been pushed back into the blade by ~2 × contactStep.
   */
  pushMargin: 2,
  /** Velocity clamp, px/s. */
  maxSpeed: 360,
  /** Scale on the angular part of the contact correction. */
  angularScale: 0.35,
  /** Angular velocity clamp, rad/s (finalize). */
  maxAngVel: 20,
  // Piling. occ = blurred cell occupancy (summed body area / cell area); the page at rest has occ ≤ ~1.1.
  /** Extra slop per unit occupancy above 1: slop = min(slopMax, slopBase + slopDensity·max(0, occ−1)). */
  slopDensity: 1.0,
  /** Cap on the slop fraction of the thinner body: lets words ride most of the way over each other. */
  slopMax: 0.9,
  /** Occupancy above which bodies are nudged down the occupancy gradient (sets the typical heap height). */
  pileLimit: 2.0,
  /** Spreading speed, px/s per unit of occupancy above pileLimit (position-only, capped at contactStep per step). */
  spreadK: 15,
  /** Render: scale gain per unit of height above heightRest. */
  heightScale: 0.06,
  /** Height smoothing rate, 1/s. */
  heightSmooth: 8,
  /**
   * Render: height at/below which a body draws exactly as the page (no scale, shade or shadow); effects fade in over
   * the next 0.35. Just above the resting maximum, so woken-but-unmoved text never grows a shadow.
   */
  heightRest: 1.1,
  /** Render height a body rises to while it rides on the blade (scoop zone, simcommon.wgsl inScoop). */
  scoopHeight: 2.0,
  /** Rate (1/s) at which a scooped body's height approaches scoopHeight. */
  scoopRate: 10,
  // Fracture.
  /**
   * Stress at which a word body breaks, before the long-word reductions (÷ max(1, aspect/3) ÷ max(1, long/60)).
   * Short words only break when squeezed at the blade, not when brushed by the chassis.
   */
  stressWord: 100,
  /**
   * Stress at which an object body breaks, before the size reduction (× min(1, stressObjectSize / longest
   * side)^stressObjectSizeExp), so blade pressure alone breaks a big image down like an icebreaker through ice.
   */
  stressObject: 60,
  /** Seconds after a break during which neither half of a word can break again. */
  fractureCooldown: 0.4,
  /** Longest side (px) above which an object's break threshold falls with its size. */
  stressObjectSize: 40,
  /** Exponent of that fall-off. */
  stressObjectSizeExp: 2,
  /**
   * Extra stress per px of blade push depth for objects (on top of the 4 / px every body gets), so one-sided blade
   * pressure breaks objects without anything pushing back. Words get none.
   */
  bladeStressObject: 8,
  /** Fraction of the parent's stress each half of a broken object keeps. Words always restart at 0. */
  stressInherit: 0.7,
  /**
   * Object halves whose longest side exceeds this (px) inherit at least their own break threshold, so a broken image
   * keeps cracking down to pieces of about this size. Smaller shards break further only under direct blade pressure.
   */
  crackSize: 70,
  /** Seconds after a break during which neither half of an object can break again. */
  fractureCooldownObject: 0.08,
} as const;

export type Tuning = Record<keyof typeof TUNING, number>;

/** TUNING with `?tune=` overrides applied; unknown keys are reported and ignored. */
export function resolveTuning(overrides: Record<string, number>): Tuning {
  const t: Tuning = { ...TUNING };
  for (const [k, v] of Object.entries(overrides)) {
    if (Object.hasOwn(TUNING, k)) t[k as keyof Tuning] = v;
    else console.warn(`[dozer] unknown tune key "${k}" (known: ${Object.keys(TUNING).join(', ')})`);
  }
  return t;
}

/**
 * blade / wing: the push quads (dozer.ts dozerPolygons); edge: the steel cutting edge (cuttingEdge, 3 points);
 * region: the blade sprite region (bladeRegion, 2 quads).
 */
export interface SimUniforms {
  dt: number;
  frame: number;
  dozer: DozerState;
  blade: V2[];
  wing: V2[];
  edge: V2[];
  region: V2[][];
}

export interface Sim {
  step(encoder: GPUCommandEncoder, u: SimUniforms): void;
  /** Pose buffer holding the latest final pose (what the renderer should read). */
  swapIndex(): 0 | 1;
  /** Back to pose[0] as the current buffer (call after re-uploading both pose buffers; see resetSimBuffers). */
  reset(): void;
}

/** SimU struct size in bytes (common.wgsl). */
const UNIFORM_BYTES = 352;
const SIM_PASS: GPUComputePassDescriptor = { label: 'sim' };
const WG = 256;

/**
 * `prof` (`?prof` only): each dispatch runs in its own timestamped compute pass, labelled by stage (or, with
 * prof.split false, the whole step is one timed pass).
 */
export function createSim(device: GPUDevice, sim: SimBuffers, cfg: Config, prof: Prof | null = null): Sim {
  const { grid } = sim;
  const iterations = cfg.iterations;
  const tuning = resolveTuning(cfg.tune);
  if (Object.keys(cfg.tune).length) console.log('[dozer] tuning', tuning);
  const uniforms = device.createBuffer({
    label: 'sim uniforms',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uData = new ArrayBuffer(UNIFORM_BYTES);
  const uF = new Float32Array(uData);
  const uU = new Uint32Array(uData);

  const prefix = `${commonWgsl}\n${simCommonWgsl}\n`;
  const pipeline = (label: string, code: string, entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label,
      layout: 'auto',
      compute: { module: device.createShaderModule({ label, code: prefix + code }), entryPoint },
    });
  /** Bind group: binding 0 = uniforms, binding k = buffers[k-1]. */
  const bind = (p: GPUComputePipeline, label: string, buffers: GPUBuffer[]): GPUBindGroup =>
    device.createBindGroup({
      label,
      layout: p.getBindGroupLayout(0),
      entries: [uniforms, ...buffers].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  const sparse = (p: GPUComputePipeline, label: string, entries: Record<number, GPUBuffer>): GPUBindGroup =>
    device.createBindGroup({
      label,
      layout: p.getBindGroupLayout(0),
      entries: [[0, uniforms] as const, ...Object.entries(entries).map(([k, b]) => [Number(k), b] as const)].map(
        ([binding, buffer]) => ({ binding, resource: { buffer } }),
      ),
    });
  const both = <T>(f: (i: 0 | 1) => T): [T, T] => [f(0), f(1)];

  const integrateP = pipeline('integrate', integrateWgsl, 'integrate');
  const integrateBG = both((c) =>
    bind(integrateP, `integrate${c}`, [sim.pose[c], sim.motion, sim.props, sim.wake, sim.counters, sim.shape]),
  );

  // grid.wgsl bindings: 1 counters, 2 cellCount, 3 cellData, 4 cellCursor, 5 occupancy, 6 cellRange, 7 pose,
  // 8 shape, 9 props
  const clearP = pipeline('clearGrid', gridWgsl, 'clearGrid');
  const clearBG = sparse(clearP, 'clearGrid', { 1: sim.counters, 2: grid.cellCount, 5: grid.occupancy });
  const countP = pipeline('countCells', gridWgsl, 'countCells');
  const countBG = both((c) =>
    sparse(countP, `countCells${c}`, {
      1: sim.counters,
      2: grid.cellCount,
      5: grid.occupancy,
      6: grid.cellRange,
      7: sim.pose[c],
      8: sim.shape,
      9: sim.props,
    }),
  );
  const scanP = pipeline('scanCells', gridWgsl, 'scanCells');
  const scanBG = sparse(scanP, 'scanCells', { 2: grid.cellCount, 3: grid.cellData, 4: grid.cellCursor });
  const scatterP = pipeline('scatter', gridWgsl, 'scatter');
  const scatterBG = sparse(scatterP, 'scatter', {
    1: sim.counters,
    3: grid.cellData,
    4: grid.cellCursor,
    6: grid.cellRange,
    9: sim.props,
  });

  // pile.wgsl bindings: 1 occupancy, 2 occF, 3 pose, 4 props, 5 shape
  const resolveP = pipeline('resolveOcc', pileWgsl, 'resolveOcc');
  const resolveBG = sparse(resolveP, 'resolveOcc', { 1: grid.occupancy, 2: grid.occF });
  const spreadP = pipeline('spread', pileWgsl, 'spread');
  const spreadBG = both((c) =>
    sparse(spreadP, `spread${c}`, {
      2: grid.occF,
      3: sim.pose[c],
      4: sim.props,
      5: sim.shape,
    }),
  );

  const contactsP = pipeline('contacts', contactsWgsl, 'contacts');
  // contactsBG[c] reads pose[c] and writes pose[1 - c].
  const contactsBG = both((c) =>
    bind(contactsP, `contacts${c}`, [
      sim.pose[c],
      sim.pose[1 - c]!,
      sim.shape,
      sim.props,
      sim.wake,
      grid.cellData,
      grid.cellRange,
      grid.occF,
    ]),
  );

  const dozerPreP = pipeline('dozerPre', dozerWgsl, 'dozerPre');
  const dozerPostP = pipeline('dozerPost', dozerWgsl, 'dozerPost');
  // 6 storage buffers (≤ 8): motion is bound so the blade can set the velocity of the bodies it pushes.
  const dozerBufs = (c: 0 | 1): GPUBuffer[] => [sim.pose[c], sim.shape, sim.props, sim.wake, sim.counters, sim.motion];
  const dozerPreBG = both((c) => bind(dozerPreP, `dozerPre${c}`, dozerBufs(c)));
  const dozerPostBG = both((c) => bind(dozerPostP, `dozerPost${c}`, dozerBufs(c)));

  const finalizeP = pipeline('finalize', finalizeWgsl, 'finalize');
  const finalizeBG = both((c) =>
    bind(finalizeP, `finalize${c}`, [sim.pose[c], sim.motion, sim.props, sim.counters, grid.occF]),
  );

  // fracture.wgsl bindings: 1 pose, 2 motion, 3 shape, 4 props, 5 counters, 6 indirect
  const snapshotP = pipeline('fractureSnapshot', fractureWgsl, 'fractureSnapshot');
  const snapshotBG = sparse(snapshotP, 'fractureSnapshot', { 5: sim.counters });
  const fractureP = pipeline('fracture', fractureWgsl, 'fracture');
  const fractureBG = both((c) =>
    sparse(fractureP, `fracture${c}`, {
      1: sim.pose[c],
      2: sim.motion,
      3: sim.shape,
      4: sim.props,
      5: sim.counters,
    }),
  );
  const indirectP = pipeline('writeIndirect', fractureWgsl, 'writeIndirect');
  const indirectBG = sparse(indirectP, 'writeIndirect', { 5: sim.counters, 6: sim.indirect });

  const bodyGroups = Math.ceil(sim.maxBodies / WG);
  const cellGroups = Math.ceil(grid.cells / WG);
  let cur: 0 | 1 = 0;

  // Constant fields (sizes, grid, tuning) are written into uData once; writeUniforms only refreshes the per-step ones.
  uU[2] = sim.maxBodies;
  uU[3] = iterations;
  uU[4] = grid.dim;
  uU[5] = grid.dim;
  uF[6] = GRID_CELL_SIZE;
  uF[7] = PAGE_SIZE;
  {
    const t = tuning;
    uF.set(
      [
        t.linDamp,
        t.angDamp,
        t.relax,
        t.slopBase,
        t.sleepSpeed,
        t.sleepTime,
        t.wakeDepth,
        t.pushBudgetK,
        t.pushMargin,
        t.maxSpeed,
        t.angularScale,
        t.maxAngVel,
        t.slopDensity,
        t.slopMax,
        t.pileLimit,
        t.spreadK,
        t.heightSmooth,
        t.stressWord,
        t.stressObject,
        t.fractureCooldown,
        t.friction,
        t.contactStep,
        t.contactFrac,
        t.stressObjectSize,
        t.scoopHeight,
        t.scoopRate,
        t.bladeStressObject,
        t.stressInherit,
        t.fractureCooldownObject,
        t.stressObjectSizeExp,
        t.crackSize,
        0,
      ],
      52,
    );
  }
  /** Writes points as consecutive (x, y) floats from uF[at]. */
  const putPoints = (pts: V2[], at: number): void => {
    for (let k = 0; k < pts.length; k++) {
      uF[at + 2 * k] = pts[k]![0];
      uF[at + 2 * k + 1] = pts[k]![1];
    }
  };
  const writeUniforms = (u: SimUniforms): void => {
    uF[0] = u.dt;
    uU[1] = u.frame >>> 0;
    uF[8] = u.dozer.x;
    uF[9] = u.dozer.y;
    uF[10] = u.dozer.vx;
    uF[11] = u.dozer.vy;
    putPoints(u.blade, 12);
    putPoints(u.wing, 20);
    putPoints(u.edge, 28); // uF[34..35] stay 0
    putPoints(u.region[0]!, 36);
    putPoints(u.region[1]!, 44);
    uF[84] = u.dozer.angVel; // SimU.dozerMisc
    uF[85] = Math.cos(u.dozer.angle);
    uF[86] = Math.sin(u.dozer.angle);
    device.queue.writeBuffer(uniforms, 0, uData);
  };

  return {
    step(encoder, u) {
      if (u.blade.length !== 4 || u.wing.length !== 4 || u.edge.length !== 3 || u.region.length !== 2) {
        throw new Error('sim.step: blade and wing must be quads, edge 3 points, region 2 quads');
      }
      writeUniforms(u);
      let pass = encoder.beginComputePass(
        prof && !prof.split ? { label: 'sim', timestampWrites: prof.ts('sim step') } : SIM_PASS,
      );
      const run = (p: GPUComputePipeline, bg: GPUBindGroup, groups: number): void => {
        if (prof?.split) {
          // Profiling: one pass per dispatch, so each stage gets its own timestamps.
          pass.end();
          pass = encoder.beginComputePass({ label: p.label, timestampWrites: prof.ts(p.label) });
        }
        pass.setPipeline(p);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(groups);
      };
      run(clearP, clearBG, cellGroups);
      run(integrateP, integrateBG[cur], bodyGroups);
      run(dozerPreP, dozerPreBG[cur], bodyGroups);
      run(countP, countBG[cur], bodyGroups);
      run(resolveP, resolveBG, cellGroups);
      run(scanP, scanBG, 1);
      run(scatterP, scatterBG, bodyGroups);
      for (let k = 0; k < iterations; k++) {
        run(contactsP, contactsBG[cur], bodyGroups);
        cur = cur === 0 ? 1 : 0;
      }
      run(spreadP, spreadBG[cur], bodyGroups);
      run(dozerPostP, dozerPostBG[cur], bodyGroups);
      run(finalizeP, finalizeBG[cur], bodyGroups);
      run(snapshotP, snapshotBG, 1);
      run(fractureP, fractureBG[cur], bodyGroups);
      run(indirectP, indirectBG, 1);
      pass.end();
    },
    swapIndex: () => cur,
    reset() {
      cur = 0;
    },
  };
}

/**
 * Minimum time between two stats copies (the only readback in the loop). Short, because the break sounds are
 * scheduled from the fragment count in each sample.
 */
export const STATS_INTERVAL_MS = 100;

/** Counter-derived stats plus the simulation frame count at the time of the copy (`sampleFrame`). */
export type CounterStats = Partial<Stats> & { sampleFrame?: number };

/**
 * HUD stats readback: copies `counters` (layout in buffers.ts) into one of two MAP_READ buffers at most every
 * STATS_INTERVAL_MS, skips the copy while a map is pending, and parses the result when mapAsync resolves.
 * Contract: the encoder passed to request() must be submitted in the same task (the map starts in a microtask,
 * after the submit, because a buffer may not be mapped while a pending command buffer still writes it).
 */
export function createStatsReader(
  device: GPUDevice,
  counters: GPUBuffer,
  maxBodies = Infinity,
): {
  request(encoder: GPUCommandEncoder, frame?: number): void;
  latest(): CounterStats;
} {
  const size = COUNTERS_U32 * 4;
  const staging = [0, 1].map((i) =>
    device.createBuffer({ label: `stats${i}`, size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  );
  let next = 0;
  let pending = false;
  let lastCopy = -Infinity;
  let latest: CounterStats = {};
  return {
    request(encoder, frame = 0) {
      const now = performance.now();
      if (pending || now - lastCopy < STATS_INTERVAL_MS) return;
      lastCopy = now;
      pending = true;
      const dst = staging[next]!;
      next = 1 - next;
      encoder.copyBufferToBuffer(counters, 0, dst, 0, size);
      queueMicrotask(() => {
        dst
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            try {
              const c = new Uint32Array(dst.getMappedRange());
              latest = {
                bodies: Math.min(c[0]!, maxBodies),
                gridOverflow: c[1]!,
                active: c[2]!,
                asleep: c[3]!,
                fragments: c[4]!,
                sampleFrame: frame,
              };
            } finally {
              dst.unmap(); // even if parsing throws, so the buffer can be copied into again
            }
          })
          .catch((err: unknown) => {
            console.warn('[dozer] stats readback failed', err);
          })
          .finally(() => {
            pending = false;
          });
      });
    },
    latest: () => latest,
  };
}
