/**
 * Playback store (t2-2): one clock, deterministic ticks.
 *
 * The store has no internal timers — tests drive it with explicit
 * `tick(deltaMs)` calls, so every assertion is exact.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlaybackStore,
  stepIndexAt,
  stepNumberAt,
  SPEED_OPTIONS,
} from './playbackStore';
import { buildSuccessManifest } from './fixtures';

const manifest = buildSuccessManifest();
const DURATION = manifest.durationMs;
const STEP = 7500;

function makeStore(): PlaybackStore {
  const store = new PlaybackStore({ fixtureId: 'success' });
  store.setDuration(DURATION);
  return store;
}

describe('stepIndexAt / stepNumberAt', () => {
  it('derives the step from the clock + storyboard (boundaries)', () => {
    expect(stepIndexAt(manifest.steps, DURATION, 0)).toBe(0);
    expect(stepIndexAt(manifest.steps, DURATION, STEP - 1)).toBe(0);
    expect(stepIndexAt(manifest.steps, DURATION, STEP)).toBe(1);
    expect(stepIndexAt(manifest.steps, DURATION, 5 * STEP + 1000)).toBe(5);
    expect(stepIndexAt(manifest.steps, DURATION, DURATION)).toBe(7);
  });

  it('clamps outside times to the first/last step', () => {
    expect(stepIndexAt(manifest.steps, DURATION, -1000)).toBe(0);
    expect(stepIndexAt(manifest.steps, DURATION, DURATION + 1000)).toBe(7);
  });

  it('stepNumberAt is 1-based', () => {
    expect(stepNumberAt(manifest, 0)).toBe(1);
    expect(stepNumberAt(manifest, DURATION)).toBe(8);
  });
});

describe('PlaybackStore clock', () => {
  let store: PlaybackStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('starts at 0, paused, speed 1', () => {
    expect(store.getState()).toMatchObject({
      timeMs: 0,
      playing: false,
      speed: 1,
      fixtureId: 'success',
    });
  });

  it('tick is a no-op while paused', () => {
    store.tick(1000);
    expect(store.getState().timeMs).toBe(0);
  });

  it('advances by delta * speed while playing', () => {
    store.play();
    store.tick(1000);
    expect(store.getState().timeMs).toBe(1000);
    store.setSpeed(2);
    store.tick(1000);
    expect(store.getState().timeMs).toBe(3000);
    store.setSpeed(0.5);
    store.tick(1000);
    expect(store.getState().timeMs).toBe(3500);
  });

  it('clamps at the end and auto-pauses', () => {
    store.play();
    store.tick(DURATION);
    expect(store.getState()).toMatchObject({ timeMs: DURATION, playing: false });
    // Parked at the end: ticks are no-ops until play() restarts the story.
    store.tick(5000);
    expect(store.getState()).toMatchObject({ timeMs: DURATION, playing: false });
  });

  it('playing from the end restarts the story', () => {
    store.scrub(DURATION);
    store.play();
    expect(store.getState().timeMs).toBe(0);
    expect(store.getState().playing).toBe(true);
  });

  it('scrub clamps to [0, duration]', () => {
    store.scrub(-50);
    expect(store.getState().timeMs).toBe(0);
    store.scrub(DURATION + 50);
    expect(store.getState().timeMs).toBe(DURATION);
    store.scrub(3 * STEP);
    expect(store.getState().timeMs).toBe(3 * STEP);
  });

  it('restart returns to 0 and pauses', () => {
    store.play();
    store.tick(1234);
    store.restart();
    expect(store.getState()).toMatchObject({ timeMs: 0, playing: false });
  });

  it('notifies subscribers on change and not on no-op', () => {
    let calls = 0;
    store.subscribe(() => calls++);
    store.tick(1000); // paused → no-op
    expect(calls).toBe(0);
    store.play();
    expect(calls).toBe(1);
  });
});

describe('PlaybackStore stepping', () => {
  let store: PlaybackStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('stepForward jumps to the start of the next step', () => {
    store.stepForward(manifest.steps);
    expect(store.getState().timeMs).toBe(STEP);
    store.stepForward(manifest.steps);
    expect(store.getState().timeMs).toBe(2 * STEP);
  });

  it('stepForward at the last step parks at the end (paused)', () => {
    store.scrub(7 * STEP + 100);
    store.play();
    store.stepForward(manifest.steps);
    expect(store.getState()).toMatchObject({ timeMs: DURATION, playing: false });
  });

  it('stepBackward within a step returns to that step start', () => {
    store.scrub(3 * STEP + 2000);
    store.stepBackward(manifest.steps);
    expect(store.getState().timeMs).toBe(3 * STEP);
  });

  it('stepBackward at a step start goes to the previous step', () => {
    store.scrub(3 * STEP);
    store.stepBackward(manifest.steps);
    expect(store.getState().timeMs).toBe(2 * STEP);
  });

  it('stepBackward at 0 stays at 0', () => {
    store.stepBackward(manifest.steps);
    expect(store.getState().timeMs).toBe(0);
  });

  it('seekStep jumps to a 1-based step start', () => {
    store.seekStep(manifest.steps, 6);
    expect(store.getState().timeMs).toBe(5 * STEP);
    store.seekStep(manifest.steps, 99);
    expect(store.getState().timeMs).toBe(7 * STEP);
  });
});

describe('PlaybackStore fixture + speed', () => {
  it('setFixture restarts the clock', () => {
    const store = makeStore();
    store.play();
    store.tick(5000);
    store.setFixture('no-read');
    expect(store.getState()).toMatchObject({
      fixtureId: 'no-read',
      timeMs: 0,
      playing: false,
    });
  });

  it('setFixture is a no-op for the same fixture', () => {
    const store = makeStore();
    store.scrub(1234);
    store.setFixture('success');
    expect(store.getState().timeMs).toBe(1234);
  });

  it('setSpeed only accepts the offered speeds', () => {
    const store = makeStore();
    for (const s of SPEED_OPTIONS) {
      store.setSpeed(s);
      expect(store.getState().speed).toBe(s);
    }
  });

  it('setDuration shrinks an out-of-range clock', () => {
    const store = makeStore();
    store.scrub(DURATION);
    store.setDuration(1000);
    expect(store.getState()).toMatchObject({ timeMs: 1000, playing: false });
  });
});
