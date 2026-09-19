import * as THREE from 'three';
import { defaultConfig } from '../domain/config';
import { schemaPresets } from './schemaPresets';

describe('schema camera presets', () => {
  it('provides four named presets with finite values', () => {
    const cfg = defaultConfig();
    const presets = schemaPresets(cfg.station.lengthMm);
    expect(Object.keys(presets).sort()).toEqual(['FRONT', 'ISO', 'SIDE', 'TOP']);
    for (const p of Object.values(presets)) {
      for (const v of [...p.position, ...p.target]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('every preset looks toward the station centre', () => {
    const cfg = defaultConfig();
    const presets = schemaPresets(cfg.station.lengthMm);
    const centre = new THREE.Vector3(0, 0.3, 1.1);
    for (const p of Object.values(presets)) {
      const pos = new THREE.Vector3(...p.position);
      const target = new THREE.Vector3(...p.target);
      const forward = target.clone().sub(pos).normalize();
      const toCentre = centre.clone().sub(pos).normalize();
      expect(forward.dot(toCentre)).toBeGreaterThan(0.5);
    }
  });

  it('TOP preset frames the belt from directly above', () => {
    const cfg = defaultConfig();
    const presets = schemaPresets(cfg.station.lengthMm);
    const top = presets.TOP;
    expect(top.position[0]).toBeCloseTo(0, 6);
    expect(top.position[1]).toBeGreaterThan(2);
    expect(top.position[2]).toBeCloseTo(1.1, 6);
  });
});
