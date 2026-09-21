/**
 * t3-schema: every one of the eight report readers must be selectable,
 * fault-injectable, and exportable through the generic paths (rig id is the
 * selection key; faults flow through the CAM-004 state machine; export is a
 * JSON round-trip that preserves all rigs).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { configToJson, parseConfigImport } from '../export/json';
import { reportEightReaderConfig } from '../capture/presets';
import { SimStore } from './simStore';

describe('t3-schema: all eight readers selectable, faultable, exportable', () => {
  let store: SimStore;

  beforeEach(() => {
    store = new SimStore(reportEightReaderConfig());
  });

  it('exposes exactly eight unique rig ids (selection targets)', () => {
    const ids = store.sim.state.config.cameraRigs.map((r) => r.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('fault raise + clear round-trips for every rig id', () => {
    for (const rig of store.sim.state.config.cameraRigs) {
      store.setCameraFault(rig.id, true);
      expect(store.sim.state.cameraStates[rig.id]).toBe('FAULT');
      store.setCameraFault(rig.id, false);
      expect(store.sim.state.cameraStates[rig.id]).toBe('IDLE');
    }
  });

  it('targeting each rig by id via updateConfig works (Camera Lab selection path)', () => {
    for (const rig of store.sim.state.config.cameraRigs) {
      store.updateConfig((cfg) => ({
        ...cfg,
        cameraRigs: cfg.cameraRigs.map((r) =>
          r.id === rig.id ? { ...r, enabled: false } : r,
        ),
      }));
      expect(
        store.sim.state.config.cameraRigs.find((r) => r.id === rig.id)!.enabled,
      ).toBe(false);
      store.updateConfig((cfg) => ({
        ...cfg,
        cameraRigs: cfg.cameraRigs.map((r) =>
          r.id === rig.id ? { ...r, enabled: true } : r,
        ),
      }));
      expect(
        store.sim.state.config.cameraRigs.find((r) => r.id === rig.id)!.enabled,
      ).toBe(true);
    }
  });

  it('config export + import round-trips all eight rigs intact', () => {
    const res = parseConfigImport(configToJson(store.sim.state.config));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.config.cameraRigs).toHaveLength(8);
    expect(res.config.cameraRigs.map((r) => r.id).sort()).toEqual(
      store.sim.state.config.cameraRigs.map((r) => r.id).sort(),
    );
  });
});
