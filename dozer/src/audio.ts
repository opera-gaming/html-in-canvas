// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Engine sound: a recorded diesel loop (public/dozer/engine.ogg) played through Web Audio, its pitch and level
// following the engine load (engine.ts). The AudioContext starts as soon as the engine loop has loaded; where autoplay
// is blocked it stays suspended until the first key or pointer press, and the HUD asks for one. M toggles mute
// (remembered in localStorage when available). The context is suspended while the page is hidden. Inside an iframe
// (the Gamer Room's arcade screen) the host page can mute it too: a same-origin {type: 'dozer-mute', muted} message.

/** Time constant (s) of the playbackRate / gain ramps (setTargetAtTime), so load changes never zipper. */
const RAMP = 0.12;
const MUTE_KEY = 'dozer.muted';

// Mix: every file is normalised at decode time to NORM_RMS_DB RMS (peak ≤ NORM_PEAK_DB), so these gains alone set
// the balance.
/** Engine gain at full load. */
export const ENGINE_GAIN = 0.64;
/** Scrape loop gain at full forward speed. */
export const SCRAPE_GAIN = 0.525;
/** Base gain of one break hit. */
export const BREAK_GAIN = 0.1125;
/** Normalisation target RMS (dBFS), peak ceiling (dBFS) and the gate below which samples don't count toward RMS. */
export const NORM_RMS_DB = -20;
export const NORM_PEAK_DB = -1;
export const NORM_GATE_DB = -50;

/** Levels of a buffer before normalisation and the scale applied (normalizeBuffer). */
export interface NormInfo {
  rmsDb: number;
  peakDb: number;
  scale: number;
  peakLimited: boolean;
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/**
 * Scales all channels by one factor so the RMS of the samples at or above NORM_GATE_DB (leading and trailing silence
 * don't count) hits `targetRmsDb`, limited so the peak stays ≤ `peakCeilDb`. Returns new arrays and the measurements.
 * A silent buffer is returned unscaled.
 */
export function normalizeBuffer(
  channels: Float32Array[],
  targetRmsDb: number,
  peakCeilDb: number,
  gateDb = NORM_GATE_DB,
): { channels: Float32Array<ArrayBuffer>[]; info: NormInfo } {
  const gate = 10 ** (gateDb / 20);
  let sum = 0,
    n = 0,
    peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]!);
      if (a > peak) peak = a;
      if (a >= gate) {
        sum += a * a;
        n++;
      }
    }
  }
  const rms = n > 0 ? Math.sqrt(sum / n) : 0;
  const byRms = rms > 0 ? 10 ** (targetRmsDb / 20) / rms : 1;
  const byPeak = peak > 0 ? 10 ** (peakCeilDb / 20) / peak : 1;
  const scale = Math.min(byRms, byPeak);
  return {
    channels: channels.map((ch) => Float32Array.from(ch, (v) => v * scale)),
    info: { rmsDb: db(rms), peakDb: db(peak), scale, peakLimited: byPeak < byRms },
  };
}

/** Scrape gain/rate ramp time constant (s): fades in and out without clicks. */
const SCRAPE_RAMP = 0.1;
/** Skipped at each end of the scrape loop (s). */
const SCRAPE_EDGE = 0.02;

/** Break hits scheduled per stats sample at most (a bigger burst plays louder hits instead of more of them). */
export const MAX_BREAKS_PER_SAMPLE = 8;
/** Break voices playing at once at most. */
const MAX_BREAK_VOICES = 12;

/** One scheduled break hit: start offset (s) into the coming sample interval, playback rate, gain. */
export interface BreakHit {
  offset: number;
  rate: number;
  gain: number;
}

/**
 * Plans the break sounds for `delta` new fragments seen in one stats sample: min(delta, cap) hits spread at random
 * over the next `interval` seconds (so a burst crackles instead of stacking into one hit), each with playback rate
 * 1 ± 15 % and gain BREAK_GAIN ± 15 %. When delta exceeds the cap, every hit is louder (up to +40 % at 8× the cap)
 * rather than more numerous. `rand` (0..1) is injectable for tests.
 */
export function planBreaks(delta: number, cap: number, interval: number, rand: () => number = Math.random): BreakHit[] {
  const n = Math.max(0, Math.min(Math.floor(delta), cap));
  const boost = delta > cap ? 1 + 0.4 * Math.min(1, Math.log2(delta / cap) / 3) : 1;
  return Array.from({ length: n }, () => ({
    offset: rand() * Math.max(0, interval),
    rate: 1 + (rand() * 2 - 1) * 0.15,
    gain: BREAK_GAIN * boost * (1 + (rand() * 2 - 1) * 0.15),
  }));
}

/** Engine playback rate at idle and at full load. */
export const ENGINE_RATE: readonly [number, number] = [1, 1.35];
/** Engine gain at idle and at full load, as a fraction of ENGINE_GAIN. */
export const ENGINE_GAIN_RANGE: readonly [number, number] = [0.45, 1];

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const mix = (r: readonly [number, number], t: number): number => r[0] + (r[1] - r[0]) * t;

/** Engine load (0..1) → playback rate and gain (ENGINE_RATE, ENGINE_GAIN_RANGE × ENGINE_GAIN). */
export function engineSound(load: number): { rate: number; gain: number } {
  const l = clamp01(load);
  return { rate: mix(ENGINE_RATE, l), gain: ENGINE_GAIN * mix(ENGINE_GAIN_RANGE, l) };
}

/** Forward speed (fraction of maxSpeed) at which the scrape reaches full gain (smoothstep from 0). */
export const SCRAPE_FULL = 0.3;
/** Scrape playback rate at rest and at full forward speed. */
export const SCRAPE_RATE: readonly [number, number] = [1, 1.15];

/**
 * Forward speed as a fraction of maxSpeed (signed: negative = reversing) → scrape loop gain and rate. Only forward
 * motion scrapes: reversing and turning on the spot (speed 0) are silent.
 */
export function scrapeSound(forward: number): { rate: number; gain: number } {
  const f = clamp01(forward);
  const t = Math.min(1, f / SCRAPE_FULL);
  return { rate: mix(SCRAPE_RATE, f), gain: SCRAPE_GAIN * t * t * (3 - 2 * t) };
}

export type SoundState = 'loading' | 'waiting' | 'running' | 'muted' | 'unavailable';

/** HUD text for a sound state ('' = nothing to say). */
export function soundHint(state: SoundState): string {
  switch (state) {
    case 'waiting':
      return 'click or press a key for sound';
    case 'muted':
      return 'sound muted (M)';
    default:
      return '';
  }
}

const readMuted = (): boolean => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeMuted = (m: boolean): void => {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* storage blocked: keep it for this page only */
  }
};

/** Message type a same-origin host page posts to mute or unmute the dozer inside its iframe. */
export const HOST_MUTE_MESSAGE = 'dozer-mute';
/** Posted to the host page once we listen, so it answers with its current mute state (its load-time post may be early). */
export const HOST_MUTE_QUERY = 'dozer-mute-query';

/**
 * The host's mute request in a window message: `muted` from a same-origin {type: HOST_MUTE_MESSAGE, muted: boolean},
 * else null (other origins and other messages are ignored).
 */
export function hostMuteFrom(data: unknown, origin: string, ownOrigin: string): boolean | null {
  if (origin !== ownOrigin || typeof data !== 'object' || data === null) return null;
  const m = data as { type?: unknown; muted?: unknown };
  return m.type === HOST_MUTE_MESSAGE && typeof m.muted === 'boolean' ? m.muted : null;
}

/** The part of an AudioContext followVisibility drives. */
export type Suspendable = Pick<AudioContext, 'state' | 'suspend' | 'resume'>;

/**
 * Suspends `c` while `doc` is hidden and resumes it when the page shows again, but only if it was running when it
 * was hidden (a context still waiting for a gesture stays suspended). `resumeOnShow` starts true for a context that
 * was created while hidden and should start once shown. Returns a function that stops following.
 */
export function followVisibility(c: Suspendable, doc: Document = document, resumeOnShow = false): () => void {
  let wasRunning = resumeOnShow;
  const onChange = (): void => {
    if (doc.hidden) {
      if (c.state === 'running') {
        wasRunning = true;
        void c.suspend().catch(() => {});
      }
    } else if (wasRunning) {
      wasRunning = false;
      if (c.state === 'suspended') void c.resume().catch(() => {});
    }
  };
  doc.addEventListener('visibilitychange', onChange);
  return () => doc.removeEventListener('visibilitychange', onChange);
}

export interface EngineAudio {
  /** Call every frame with the engine load (0..1) and the forward speed as a fraction of maxSpeed (signed). */
  setLoad(load: number, forward?: number): void;
  /**
   * Call with each new stats sample's fragmentsMade: plays break hits for the increase, spread over the next
   * `interval` seconds. A decrease (R reset) just resynchronises.
   */
  onFragments(fragments: number, interval: number): void;
  /** Break hits started so far (debug). */
  breaksPlayed(): number;
  /** Current master gain value, null before the context exists (debug: 0 when muted by M or by the host page). */
  masterGain(): number | null;
  toggleMute(): void;
  state(): SoundState;
}

/**
 * Fetches the engine loop, the fracture hit and the blade scrape loop at once; creates the AudioContext, decodes and
 * starts the loops once the engine loop has loaded, resuming a suspended context on a keydown or pointerdown on
 * `target`. A missing or undecodable file means no sound of
 * that kind and a console.warn (never an error). Everything goes through one master gain, which M mutes.
 */
export function createEngineAudio(
  url: string,
  breakUrl: string,
  scrapeUrl: string,
  target: EventTarget = window,
  debug = false,
): EngineAudio {
  let muted = readMuted();
  /** Muted by the host page around our iframe (HOST_MUTE_MESSAGE); never stored. */
  let hostMuted = false;
  let st: SoundState = 'loading';
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let master: GainNode | null = null;
  let breakBuf: AudioBuffer | null = null;
  let breakVoices = 0;
  let breaksPlayed = 0;
  let lastFragments: number | null = null;
  let scrapeSrc: AudioBufferSourceNode | null = null;
  let scrapeGain: GainNode | null = null;
  let load = 0,
    forward = 0;
  const fail = (why: unknown): void => {
    console.warn('[dozer] engine sound unavailable:', why);
    st = 'unavailable';
  };
  const fetchBytes = (u: string): Promise<ArrayBuffer> =>
    fetch(u).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${u}`);
      return r.arrayBuffer();
    });
  const bytes = fetchBytes(url);
  bytes.then(() => {
    if (st === 'loading') st = 'waiting';
  }, fail);
  // Break and scrape failures are reported when decoding is attempted.
  const breakBytes = fetchBytes(breakUrl);
  breakBytes.catch(() => {});
  const scrapeBytes = fetchBytes(scrapeUrl);
  scrapeBytes.catch(() => {});

  // Last scheduled targets: a new ramp is only scheduled when the target moves noticeably, so the automation timeline
  // doesn't collect an event every frame.
  let lastRate = -1,
    lastGain = -1,
    lastScrapeRate = -1,
    lastScrapeGain = -1;
  const apply = (): void => {
    if (ctx && scrapeSrc && scrapeGain) {
      const sc = scrapeSound(forward);
      if (Math.abs(sc.gain - lastScrapeGain) > 0.003) {
        scrapeGain.gain.setTargetAtTime(sc.gain, ctx.currentTime, SCRAPE_RAMP);
        lastScrapeGain = sc.gain;
      }
      if (Math.abs(sc.rate - lastScrapeRate) > 0.004) {
        scrapeSrc.playbackRate.setTargetAtTime(sc.rate, ctx.currentTime, SCRAPE_RAMP);
        lastScrapeRate = sc.rate;
      }
    }
    if (!ctx || !source || !gain) return;
    const p = engineSound(load);
    const g = p.gain;
    const t = ctx.currentTime;
    if (Math.abs(p.rate - lastRate) > 0.004) {
      source.playbackRate.setTargetAtTime(p.rate, t, RAMP);
      lastRate = p.rate;
    }
    if (Math.abs(g - lastGain) > 0.004) {
      gain.gain.setTargetAtTime(g, t, RAMP);
      lastGain = g;
    }
  };
  const applyMute = (): void => {
    if (ctx && master) master.gain.setTargetAtTime(muted || hostMuted ? 0 : 1, ctx.currentTime, 0.03);
  };
  /** Decodes `bytes` and returns its normalised channels (logged under ?debug). */
  const decodeNormalized = async (
    c: AudioContext,
    data: ArrayBuffer,
    name: string,
  ): Promise<{ channels: Float32Array<ArrayBuffer>[]; sampleRate: number }> => {
    const decoded = await c.decodeAudioData(data.slice(0));
    const raw = Array.from({ length: decoded.numberOfChannels }, (_, k) => decoded.getChannelData(k));
    const { channels, info } = normalizeBuffer(raw, NORM_RMS_DB, NORM_PEAK_DB);
    if (debug) {
      const limited = info.peakLimited ? ' (peak-limited)' : '';
      console.log(
        `[dozer] audio ${name}: rms ${info.rmsDb.toFixed(1)} dBFS, peak ${info.peakDb.toFixed(1)} dBFS, ` +
          `scale ${info.scale.toFixed(3)}${limited}`,
      );
    }
    return { channels, sampleRate: decoded.sampleRate };
  };
  const toBuffer = (c: AudioContext, channels: Float32Array<ArrayBuffer>[], sampleRate: number): AudioBuffer => {
    const buf = c.createBuffer(channels.length, channels[0]!.length, sampleRate);
    channels.forEach((data, k) => buf.copyToChannel(data, k));
    return buf;
  };
  const start = async (): Promise<void> => {
    try {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not supported');
      ctx = new AC();
      const engine = await decodeNormalized(ctx, await bytes, 'engine.ogg');
      const buf = toBuffer(ctx, engine.channels, engine.sampleRate);
      source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;
      master = ctx.createGain();
      master.gain.value = muted || hostMuted ? 0 : 1;
      master.connect(ctx.destination);
      gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(master);
      source.start();
      apply();
      try {
        const b = await decodeNormalized(ctx, await breakBytes, 'break.ogg');
        breakBuf = toBuffer(ctx, b.channels, b.sampleRate);
      } catch (err) {
        console.warn('[dozer] break sound unavailable:', err);
      }
      try {
        // Near white noise: looped as is, skipping SCRAPE_EDGE at both ends (Vorbis edge silence). It runs from the
        // start at gain 0 and is only faded, never restarted.
        const sc = await decodeNormalized(ctx, await scrapeBytes, 'scraping.ogg');
        const sb = toBuffer(ctx, sc.channels, sc.sampleRate);
        scrapeSrc = ctx.createBufferSource();
        scrapeSrc.buffer = sb;
        scrapeSrc.loop = true;
        scrapeSrc.loopStart = Math.min(SCRAPE_EDGE, sb.duration / 4);
        scrapeSrc.loopEnd = Math.max(scrapeSrc.loopStart, sb.duration - SCRAPE_EDGE);
        scrapeGain = ctx.createGain();
        scrapeGain.gain.value = 0;
        scrapeSrc.connect(scrapeGain).connect(master);
        scrapeSrc.start(0, scrapeSrc.loopStart);
        apply();
      } catch (err) {
        console.warn('[dozer] scraping sound unavailable:', err);
      }
      // Not awaited: without a user activation the context stays suspended until the first gesture resumes it.
      // A page that is hidden by now starts its sound when it is shown.
      const c = ctx;
      const sync = (): void => {
        if (c.state === 'running') st = 'running';
      };
      c.addEventListener('statechange', sync);
      followVisibility(c, document, document.hidden);
      if (document.hidden) void c.suspend().catch(() => {});
      else void c.resume().then(sync, () => {});
      sync();
    } catch (err) {
      fail(err);
      void ctx?.close().catch(() => {});
    }
  };
  const onGesture = (): void => {
    if (st === 'unavailable') return;
    if (ctx) {
      if (ctx.state === 'running') {
        target.removeEventListener('keydown', onGesture, true);
        target.removeEventListener('pointerdown', onGesture, true);
      } else void ctx.resume();
      return;
    }
    void start();
  };
  target.addEventListener('keydown', onGesture, true);
  target.addEventListener('pointerdown', onGesture, true);
  // Arriving by a click from the landing page the page may already play sound: start at once, and if the context
  // comes up suspended the first key or click resumes it.
  bytes.then(
    () => {
      if (!ctx && st !== 'unavailable') void start();
    },
    () => {},
  );
  if (window.self !== window.top) {
    window.addEventListener('message', (e) => {
      const m = hostMuteFrom(e.data, e.origin, location.origin);
      if (m === null) return;
      hostMuted = m;
      if (debug) console.log(`[dozer] host ${m ? 'muted' : 'unmuted'} the sound`);
      applyMute();
    });
    window.parent.postMessage({ type: HOST_MUTE_QUERY }, location.origin);
  }

  return {
    setLoad(l, f = 0) {
      load = l;
      forward = f;
      apply();
    },
    onFragments(fragments, interval) {
      const prev = lastFragments;
      lastFragments = fragments;
      if (prev === null || !(fragments > prev) || !ctx || !master || !breakBuf || st !== 'running') return;
      const t0 = ctx.currentTime;
      for (const hit of planBreaks(fragments - prev, MAX_BREAKS_PER_SAMPLE, interval)) {
        if (breakVoices >= MAX_BREAK_VOICES) break;
        const src = ctx.createBufferSource();
        src.buffer = breakBuf;
        src.playbackRate.value = hit.rate;
        const g = ctx.createGain();
        g.gain.value = hit.gain;
        src.connect(g).connect(master);
        breakVoices++;
        breaksPlayed++;
        src.onended = () => {
          breakVoices--;
          src.disconnect();
          g.disconnect();
        };
        src.start(t0 + hit.offset);
      }
    },
    breaksPlayed: () => breaksPlayed,
    masterGain: () => (master ? master.gain.value : null),
    toggleMute() {
      muted = !muted;
      writeMuted(muted);
      applyMute();
    },
    state: () => ((st === 'running' || st === 'waiting') && muted ? 'muted' : st),
  };
}
