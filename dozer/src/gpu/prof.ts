// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Frame profiler, enabled by `?prof` only (main.ts creates it; everything else takes `Prof | null` and skips all
// profiling work when it is null).
//
// GPU: with the 'timestamp-query' feature, every labelled pass gets a begin/end timestamp pair (sim.ts splits its
// compute pass into one pass per dispatch in this mode; the render pass is one pair). At the end of a frame the
// queries are resolved, copied to a MAP_READ buffer from a small pool and accumulated per label when the map resolves.
// CPU: labelled durations measured in main.ts, plus queue.writeBuffer calls and bytes (wrapped while profiling).
//
// report() returns per-frame averages since the last reset(): `gpu[label]` = mean GPU ms per frame and per pass
// (a label can occur twice per frame: two sim steps), `cpu[label]` = mean / max ms per frame.

export interface ProfStat {
  perFrameMs: number;
  perPassMs: number;
  passesPerFrame: number;
}
export interface ProfCpuStat {
  meanMs: number;
  maxMs: number;
  p95Ms: number;
}
export interface ProfReport {
  frames: number;
  gpuFrames: number;
  timestamps: boolean;
  /** Sum of every timed pass, per frame. */
  gpuTotalMs: number;
  gpu: Record<string, ProfStat>;
  cpu: Record<string, ProfCpuStat>;
  writeBuffer: {
    callsPerFrame: number;
    bytesPerFrame: number;
    byLabel: Record<string, { callsPerFrame: number; bytesPerFrame: number }>;
  };
  /** rAF-to-rAF interval stats (ms). */
  interval: ProfCpuStat;
}

export interface Prof {
  /** True: one timed compute pass per sim dispatch; false (`?prof=coarse`): one timed pass per sim step. */
  readonly split: boolean;
  /** Timestamp writes for one labelled pass this frame (undefined without timestamp-query or once out of slots). */
  ts(label: string): GPUComputePassTimestampWrites | undefined;
  /** Resolves this frame's queries into `encoder` (the frame's last encoder) and schedules their readback. */
  endFrame(encoder: GPUCommandEncoder): void;
  cpu(label: string, ms: number): void;
  interval(ms: number): void;
  report(): ProfReport;
  reset(): void;
}

const MAX_QUERIES = 256;
const POOL = 4;

/** Device features to request for profiling: 'timestamp-query' when the adapter has it. */
export function profFeatures(adapter: GPUAdapter): GPUFeatureName[] {
  return adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
}

export function createProf(device: GPUDevice, split = true): Prof {
  const timestamps = device.features.has('timestamp-query');
  const querySet = timestamps ? device.createQuerySet({ type: 'timestamp', count: MAX_QUERIES }) : null;
  const size = MAX_QUERIES * 8;
  const resolve = timestamps
    ? device.createBuffer({
        label: 'prof resolve',
        size,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
    : null;
  const free: GPUBuffer[] = timestamps
    ? Array.from({ length: POOL }, (_, i) =>
        device.createBuffer({ label: `prof read${i}`, size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      )
    : [];
  let labels: string[] = [];

  let gpuSum: Record<string, { ms: number; n: number }> = {};
  let gpuFrames = 0;
  let cpuSamples: Record<string, number[]> = {};
  let cpuFrame: Record<string, number> = {};
  let intervals: number[] = [];
  let frames = 0;
  let wbFrame = { calls: 0, bytes: 0 };
  let wbSum = { calls: 0, bytes: 0 };
  let wbLabel: Record<string, { calls: number; bytes: number }> = {};
  let generation = 0;

  // Count queue.writeBuffer calls and bytes, by destination buffer label.
  const queue = device.queue;
  const write = queue.writeBuffer.bind(queue);
  queue.writeBuffer = ((
    buffer: GPUBuffer,
    offset: number,
    data: BufferSource | SharedArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): undefined => {
    const bpe =
      ArrayBuffer.isView(data) && 'BYTES_PER_ELEMENT' in data
        ? (data as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT
        : 1;
    const bytes = size !== undefined ? size * bpe : data.byteLength - (dataOffset ?? 0) * bpe;
    wbFrame.calls++;
    wbFrame.bytes += bytes;
    const l = (wbLabel[buffer.label || '?'] ??= { calls: 0, bytes: 0 });
    l.calls++;
    l.bytes += bytes;
    return write(buffer, offset, data as BufferSource, dataOffset, size);
  }) as GPUQueue['writeBuffer'];

  const stat = (v: number[]): ProfCpuStat => {
    if (!v.length) return { meanMs: 0, maxMs: 0, p95Ms: 0 };
    const s = [...v].sort((a, b) => a - b);
    const r = (x: number): number => Math.round(x * 1000) / 1000;
    return {
      meanMs: r(s.reduce((a, b) => a + b, 0) / s.length),
      maxMs: r(s[s.length - 1]!),
      p95Ms: r(s[Math.floor(0.95 * (s.length - 1))]!),
    };
  };

  return {
    split,
    ts(label) {
      if (!querySet || labels.length * 2 + 2 > MAX_QUERIES) return undefined;
      const i = labels.length * 2;
      labels.push(label);
      return { querySet, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
    },
    endFrame(encoder) {
      frames++;
      for (const [k, v] of Object.entries(cpuFrame)) (cpuSamples[k] ??= []).push(v);
      cpuFrame = {};
      wbSum.calls += wbFrame.calls;
      wbSum.bytes += wbFrame.bytes;
      wbFrame = { calls: 0, bytes: 0 };
      const frameLabels = labels;
      labels = [];
      if (!querySet || !resolve || !frameLabels.length) return;
      const dst = free.pop();
      if (!dst) return; // every read buffer still mapping: skip this frame's sample
      const n = frameLabels.length * 2;
      encoder.resolveQuerySet(querySet, 0, n, resolve, 0);
      encoder.copyBufferToBuffer(resolve, 0, dst, 0, n * 8);
      const gen = generation;
      // Mapped after the caller submits this encoder (same contract as createStatsReader).
      queueMicrotask(() => {
        dst
          .mapAsync(GPUMapMode.READ, 0, n * 8)
          .then(() => {
            const t = new BigUint64Array(dst.getMappedRange(0, n * 8));
            if (gen === generation) {
              frameLabels.forEach((label, k) => {
                const ms = Number(t[2 * k + 1]! - t[2 * k]!) / 1e6;
                if (!(ms >= 0 && ms < 1000)) return; // a wrapped or unwritten pair
                const s = (gpuSum[label] ??= { ms: 0, n: 0 });
                s.ms += ms;
                s.n++;
              });
              gpuFrames++;
            }
            dst.unmap();
            free.push(dst);
          })
          .catch(() => free.push(dst));
      });
    },
    cpu(label, ms) {
      cpuFrame[label] = (cpuFrame[label] ?? 0) + ms;
    },
    interval(ms) {
      intervals.push(ms);
    },
    report() {
      const r = (x: number): number => Math.round(x * 1000) / 1000;
      const gpu: Record<string, ProfStat> = {};
      let total = 0;
      for (const [k, s] of Object.entries(gpuSum)) {
        const perFrame = gpuFrames ? s.ms / gpuFrames : 0;
        total += perFrame;
        const passesPerFrame = r(gpuFrames ? s.n / gpuFrames : 0);
        gpu[k] = { perFrameMs: r(perFrame), perPassMs: r(s.ms / s.n), passesPerFrame };
      }
      const cpu: Record<string, ProfCpuStat> = {};
      for (const [k, v] of Object.entries(cpuSamples)) cpu[k] = stat(v);
      const f = Math.max(frames, 1);
      const byLabel: Record<string, { callsPerFrame: number; bytesPerFrame: number }> = {};
      for (const [k, v] of Object.entries(wbLabel)) {
        byLabel[k] = { callsPerFrame: r(v.calls / f), bytesPerFrame: Math.round(v.bytes / f) };
      }
      return {
        frames,
        gpuFrames,
        timestamps,
        gpuTotalMs: r(total),
        gpu,
        cpu,
        writeBuffer: { callsPerFrame: r(wbSum.calls / f), bytesPerFrame: Math.round(wbSum.bytes / f), byLabel },
        interval: stat(intervals),
      };
    },
    reset() {
      generation++;
      gpuSum = {};
      gpuFrames = 0;
      cpuSamples = {};
      intervals = [];
      frames = 0;
      wbSum = { calls: 0, bytes: 0 };
      wbLabel = {};
    },
  };
}
