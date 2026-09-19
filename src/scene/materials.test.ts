import { MATERIAL_PRESETS, getMaterialParams } from './materials';
import type { MaterialPreset } from '../domain/types';

const ALL_PRESETS: MaterialPreset[] = [
  'KRAFT',
  'WHITE_CARD',
  'DARK_CARD',
  'GLOSSY_TAPE',
  'MATTE_WRAP',
  'CUSTOM',
];

describe('material presets (PAR-008)', () => {
  it('provides all six presets with valid parameters', () => {
    for (const preset of ALL_PRESETS) {
      const p = MATERIAL_PRESETS[preset];
      expect(p).toBeDefined();
      expect(p.color).toBeGreaterThanOrEqual(0);
      expect(p.color).toBeLessThanOrEqual(0xffffff);
      expect(p.roughness).toBeGreaterThan(0);
      expect(p.roughness).toBeLessThanOrEqual(1);
      expect(p.metalness).toBeGreaterThanOrEqual(0);
      expect(p.metalness).toBeLessThanOrEqual(1);
    }
  });

  it('glossy tape is much glossier than matte wrap', () => {
    expect(getMaterialParams('GLOSSY_TAPE').roughness).toBeLessThan(
      getMaterialParams('MATTE_WRAP').roughness,
    );
  });

  it('getMaterialParams rejects unknown presets', () => {
    expect(() => getMaterialParams('NEON' as MaterialPreset)).toThrow(
      /Unknown material preset/,
    );
  });
});
