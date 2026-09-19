import { useSyncExternalStore } from 'react';
import type { SimConfig } from '../domain/config';
import { defaultConfig } from '../domain/config';
import { Simulation } from '../simulation/sim';

/**
 * Versioned simulation store (store/ — §9 architecture).
 *
 * The domain simulation runs OUTSIDE React: `sim.pump()` is called from the
 * render loop, then a version tick lets React re-read `sim.state` via
 * `useSyncExternalStore`. React never drives the domain clock per-frame.
 */

export class SimStore {
  private simInstance = new Simulation(defaultConfig());
  private version = 0;
  private listeners = new Set<() => void>();

  get sim(): Simulation {
    return this.simInstance;
  }

  getState = (): { version: number; sim: Simulation } => ({
    version: this.version,
    sim: this.sim,
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** Advance from the display loop, then tick React. */
  tick(realElapsedMs: number): void {
    this.sim.pump(realElapsedMs);
    this.notify();
  }

  start(): void {
    this.sim.start();
    this.notify();
  }

  pause(): void {
    this.sim.pause();
    this.notify();
  }

  reset(config?: SimConfig): void {
    this.sim.reset(config);
    this.notify();
  }

  step(n = 1): void {
    this.sim.stepMany(n);
    this.notify();
  }

  setSpeed(mmPerSec: number): void {
    this.sim.setSpeed(mmPerSec);
    this.notify();
  }

  setSpeedFactor(f: 0.25 | 0.5 | 1 | 2): void {
    this.sim.setSpeedFactor(f);
    this.notify();
  }
}

export const simStore = new SimStore();

/** Subscribe a component to simulation version ticks. */
export function useSim(): Simulation {
  useSyncExternalStore(simStore.subscribe, simStore.getState);
  return simStore.sim;
}
