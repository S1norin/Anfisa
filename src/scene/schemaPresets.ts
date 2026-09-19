/**
 * Schema view camera presets (issue #13 will consume these).
 * Units: metres. Station spans z ∈ [0, 2.2] by default.
 */

export interface SchemaPreset {
  name: 'TOP' | 'SIDE' | 'FRONT' | 'ISO';
  position: [number, number, number];
  target: [number, number, number];
}

export function schemaPresets(stationLengthMm: number): Record<SchemaPreset['name'], SchemaPreset> {
  const L = stationLengthMm / 1000;
  const mid = L / 2;
  return {
    TOP: { name: 'TOP', position: [0, 4.5, mid], target: [0, 0, mid] },
    SIDE: { name: 'SIDE', position: [3.8, 0.9, mid], target: [0, 0.35, mid] },
    FRONT: { name: 'FRONT', position: [0, 0.9, -2.2], target: [0, 0.35, mid * 0.4] },
    ISO: { name: 'ISO', position: [2.4, 2.6, L + 1.2], target: [0, 0.25, mid] },
  };
}
