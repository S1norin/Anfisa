/**
 * Material presets (PAR-008).
 *
 * Pure parameter tables (testable headless) + a THREE material factory.
 * These are VISUAL presets for the synthetic scene — labelled simulation
 * assumptions, not measured PBR values.
 */

import * as THREE from 'three';
import type { MaterialPreset } from '../domain/types';

export interface MaterialParams {
  color: number;
  roughness: number;
  metalness: number;
}

export const MATERIAL_PRESETS: Record<MaterialPreset, MaterialParams> = {
  KRAFT: { color: 0xb08a57, roughness: 0.92, metalness: 0.0 },
  WHITE_CARD: { color: 0xf2f0ea, roughness: 0.8, metalness: 0.0 },
  DARK_CARD: { color: 0x3b4046, roughness: 0.85, metalness: 0.0 },
  GLOSSY_TAPE: { color: 0x2a2c30, roughness: 0.12, metalness: 0.25 },
  MATTE_WRAP: { color: 0x8d9db0, roughness: 1.0, metalness: 0.0 },
  CUSTOM: { color: 0xcccccc, roughness: 0.5, metalness: 0.0 },
};

export function getMaterialParams(preset: MaterialPreset): MaterialParams {
  const p = MATERIAL_PRESETS[preset];
  if (!p) throw new Error(`Unknown material preset: ${String(preset)}`);
  return p;
}

export function createMaterial(preset: MaterialPreset): THREE.MeshStandardMaterial {
  const p = getMaterialParams(preset);
  return new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: p.roughness,
    metalness: p.metalness,
  });
}

/** Glossy tape strip along the top centre seam (PAR-001 tape patches). */
export const TAPE_PRESET: MaterialPreset = 'GLOSSY_TAPE';
