// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export interface AudioLike {
  volume: number;
  muted: boolean;
  loop: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

const KEY = 'music-muted';

/**
 * Calls `start` now and again on every pointerdown or keydown on `target` (autoplay may need a gesture, and one
 * gesture is not always enough: a key press in a focused iframe does not count) until `audio` fires `playing`;
 * then both listeners go. Returns a function that removes them early.
 */
export function startUntilPlaying(
  audio: Pick<HTMLMediaElement, 'paused' | 'addEventListener' | 'removeEventListener'>,
  target: EventTarget,
  start: () => void,
): () => void {
  const retry = (): void => {
    if (audio.paused) start();
  };
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    target.removeEventListener('pointerdown', retry, { capture: true });
    target.removeEventListener('keydown', retry, { capture: true });
    audio.removeEventListener('playing', stop);
  };
  target.addEventListener('pointerdown', retry, { capture: true });
  target.addEventListener('keydown', retry, { capture: true });
  audio.addEventListener('playing', stop);
  start();
  if (!audio.paused) stop();
  return stop;
}

export class Music {
  private target = 1;
  private _muted: boolean;

  constructor(
    private audio: AudioLike,
    private storage: Pick<Storage, 'getItem' | 'setItem'>,
    private fadeMs = 300,
  ) {
    // Storage can throw (privacy modes, blocked site data): treat that as not muted.
    try {
      this._muted = storage.getItem(KEY) === '1';
    } catch {
      this._muted = false;
    }
    this.target = this._muted ? 0 : 1;
    audio.volume = this.target;
    audio.loop = true;
  }

  get muted(): boolean {
    return this._muted;
  }

  start(): void {
    const p = this.audio.play();
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    this.target = this._muted ? 0 : 1;
    try {
      this.storage.setItem(KEY, this._muted ? '1' : '0');
    } catch {
      /* not persisted */
    }
    return this._muted;
  }

  update(dtMs: number): void {
    const rate = 1 / this.fadeMs;
    const d = this.target - this.audio.volume;
    const step = Math.min(Math.abs(d), rate * dtMs);
    this.audio.volume = Math.max(0, Math.min(1, this.audio.volume + Math.sign(d) * step));
  }
}
