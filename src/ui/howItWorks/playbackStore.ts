/**
 * Guided-replay playback clock (t2-2).
 *
 * ONE clock drives the whole page: the 3D parcel pose, the right-panel
 * image/stage, and the timeline all derive from `timeMs`. The store is a
 * plain external store (useSyncExternalStore) with an explicit `tick` so
 * tests advance it deterministically — no internal timers.
 *
 * Step identity is DERIVED from timeMs + the manifest storyboard
 * (never stored separately), so scrubbing and stepping can never drift
 * the step index away from the clock.
 */

import { useSyncExternalStore } from 'react';
import type { ReplayManifest } from './replayManifest';
import type { FixtureId } from './fixtures';

export const SPEED_OPTIONS = [0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

/** Minimum dwell (ms) before step-back jumps to the previous step. */
const STEP_BACK_EPS_MS = 100;

export interface PlaybackState {
  /** Replay clock, ms within the manifest (0..durationMs). */
  timeMs: number;
  playing: boolean;
  speed: PlaybackSpeed;
  /** Active fixture; changing it restarts the clock. */
  fixtureId: FixtureId;
}

/** 0-based storyboard step index for a time (clamped to the last step). */
export function stepIndexAt(
  steps: readonly { tStartMs: number }[],
  durationMs: number,
  timeMs: number,
): number {
  const t = Math.min(Math.max(timeMs, 0), durationMs);
  for (let i = steps.length - 1; i >= 0; i--) {
    if (t >= steps[i].tStartMs) return i;
  }
  return 0;
}

/** 1-based storyboard step number for a time. */
export function stepNumberAt(manifest: ReplayManifest, timeMs: number): number {
  return stepIndexAt(manifest.steps, manifest.durationMs, timeMs) + 1;
}

export class PlaybackStore {
  private state: PlaybackState;
  private durationMs = 0;
  private listeners = new Set<() => void>();

  constructor(initial: Partial<PlaybackState> = {}) {
    this.state = {
      timeMs: 0,
      playing: false,
      speed: 1,
      fixtureId: initial.fixtureId ?? 'success',
    };
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /**
   * Bind the replay duration from the manifest. Called on mount and when
   * the fixture changes.
   */
  setDuration(durationMs: number): void {
    this.durationMs = durationMs;
    if (this.state.timeMs > durationMs) {
      this.set({ timeMs: durationMs, playing: false });
    }
  }

  /** Advance the clock by a wall-clock delta. No-op while paused. */
  tick(deltaMs: number): void {
    if (!this.state.playing) return;
    const next = this.state.timeMs + deltaMs * this.state.speed;
    if (next >= this.durationMs) {
      this.set({ timeMs: this.durationMs, playing: false });
    } else {
      this.set({ timeMs: next });
    }
  }

  play(): void {
    if (this.state.timeMs >= this.durationMs) {
      // Reaching the end: play restarts the story.
      this.set({ timeMs: 0, playing: true });
      return;
    }
    this.set({ playing: true });
  }

  pause(): void {
    this.set({ playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  restart(): void {
    this.set({ timeMs: 0, playing: false });
  }

  /** Jump to an arbitrary replay time (clamped). Keeps the play state. */
  scrub(tMs: number): void {
    const clamped = Math.min(Math.max(tMs, 0), this.durationMs);
    if (clamped !== this.state.timeMs) this.set({ timeMs: clamped });
  }

  /** Jump to the start of the storyboard step `n` (1-based). */
  seekStep(steps: readonly { tStartMs: number }[], n: number): void {
    const idx = Math.min(Math.max(n - 1, 0), steps.length - 1);
    this.scrub(steps[idx].tStartMs);
  }

  /** Jump to the start of the next storyboard step (end of story: stop). */
  stepForward(steps: readonly { tStartMs: number; tEndMs: number }[]): void {
    const i = stepIndexAt(steps, this.durationMs, this.state.timeMs);
    if (i >= steps.length - 1) {
      this.set({ timeMs: this.durationMs, playing: false });
      return;
    }
    this.set({ timeMs: steps[i + 1].tStartMs });
  }

  /**
   * Jump back: to the start of the current step when we are more than
   * STEP_BACK_EPS_MS into it, otherwise to the start of the previous step.
   */
  stepBackward(steps: readonly { tStartMs: number; tEndMs: number }[]): void {
    const i = stepIndexAt(steps, this.durationMs, this.state.timeMs);
    const start = steps[i].tStartMs;
    if (this.state.timeMs - start > STEP_BACK_EPS_MS) {
      this.set({ timeMs: start });
    } else if (i > 0) {
      this.set({ timeMs: steps[i - 1].tStartMs });
    }
  }

  setSpeed(speed: PlaybackSpeed): void {
    if (speed === this.state.speed) return;
    this.set({ speed });
  }

  /** Switch fixture: restart the clock on the new story. */
  setFixture(fixtureId: FixtureId): void {
    if (fixtureId === this.state.fixtureId) return;
    this.set({ fixtureId, timeMs: 0, playing: false });
  }
}

export function usePlayback(store: PlaybackStore): PlaybackState {
  // Closure-bound: getState is a plain method and must not lose `this`
  // when React calls it standalone.
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState(),
  );
}
