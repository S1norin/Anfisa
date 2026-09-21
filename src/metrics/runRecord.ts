/**
 * Immutable run record (MET-008): the complete, JSON-safe audit trail of one
 * run — seed, config, ground truth, frame metadata, every observation, every
 * result, the computed metrics, and both event logs.
 *
 * `buildRunRecord` deep-freezes the record: once built it cannot be mutated,
 * which is what makes a saved run reproducible and diffable (CFG-004,
 * NFR-006). Only plain data crosses the boundary (no Maps, no classes).
 */

import type {
  MaterialPreset,
  ParcelResult,
  ParcelSpec,
  ProcessingMode,
  SimEvent,
} from '../domain/types';
import type { SimConfig } from '../domain/config';
import type { RunMetrics } from './metrics';

/** One captured frame (metadata only — pixel data is never stored). */
export interface RunFrameMeta {
  frameId: string;
  cameraId: string;
  simTimeMs: number;
  encoderMm: number;
  candidateParcelIds: string[];
  /** Processing mode that produced this frame's observations (t4-labeling). */
  processingMode?: ProcessingMode;
}

/** One label observation from one frame (audit-level detail). */
export interface RunObservationMeta {
  frameId: string;
  cameraId: string;
  /** Sim time of the capture (same step as the decode — zero queueing). */
  simTimeMs: number;
  parcelId: string;
  labelInstanceId: string;
  face: string;
  material: MaterialPreset;
  rotationDeg: number;
  ppm: number;
  incidenceDeg: number;
  confidence: number;
  qualityPassed: boolean;
  decoded: boolean;
  reasons: string[];
  /**
   * Additive (t7): line-scan audit fields. Present on line-strip
   * observations only — area-frame rows keep the legacy shape so old
   * records parse unchanged.
   */
  acquisitionKind?: 'LINE_SCAN';
  /** Lines actually captured by the session (t4 payload). */
  lineCount?: number;
  /** Lines the travel interval implies at the rig's encoder step. */
  expectedLineCount?: number;
  /** Encoder interval of the strip (encoder-corrected travel). */
  encoderStartMm?: number;
  encoderEndMm?: number;
  /** True when the strip closed after the full travel (no abort). */
  complete?: boolean;
  /** Abort reason when the strip was cut short (CAMERA_FAULT, …). */
  abortReason?: string;
}

/** Ground-truth parcel record (spawn + photoeye timestamps). */
export interface RunGroundTruthParcel {
  parcelId: string;
  spec: ParcelSpec;
  spawnSimTimeMs: number;
  entrySimTimeMs?: number;
  exitSimTimeMs?: number;
  sortSimTimeMs?: number;
}

/** The immutable record of one completed run. */
export interface RunRecord {
  version: 1;
  runId: string;
  seed: number;
  /** Processing mode the run used (GEOMETRY_MODEL | PIXEL_DECODER). */
  processingMode: ProcessingMode;
  config: SimConfig;
  simTimeMs: number;
  encoderMm: number;
  groundTruth: RunGroundTruthParcel[];
  frames: RunFrameMeta[];
  observations: RunObservationMeta[];
  results: ParcelResult[];
  metrics: RunMetrics;
  /** Domain events (spawns, photoeyes, captures, speed changes). */
  simEvents: SimEvent[];
  /** Processing events (finalizes, ACKs). */
  pipelineEvents: SimEvent[];
}

/**
 * The record is deep-copied and deep-frozen, so the input may be a
 * readonly view of live state (e.g. SimStore getters) — no mutation is
 * needed or performed.
 */
export interface RunRecordInput {
  runId: string;
  seed: number;
  /** Processing mode the run used (t4-labeling). */
  processingMode: ProcessingMode;
  config: SimConfig;
  simTimeMs: number;
  encoderMm: number;
  groundTruth: readonly RunGroundTruthParcel[];
  frames: readonly RunFrameMeta[];
  observations: readonly RunObservationMeta[];
  results: readonly ParcelResult[];
  metrics: RunMetrics;
  simEvents: readonly SimEvent[];
  pipelineEvents: readonly SimEvent[];
}

/** Recursively freeze an object (plain data only). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Build the immutable run record. The input is deep-copied (so late mutation
 * of live objects cannot leak in) and deep-frozen.
 */
export function buildRunRecord(input: RunRecordInput): RunRecord {
  // JSON round-trip: guarantees plain data only (no Maps/classes/undefined
  // holes) and detaches the record from live objects.
  const copy: RunRecord = JSON.parse(
    JSON.stringify({
      version: 1,
      runId: input.runId,
      seed: input.seed,
      processingMode: input.processingMode,
      config: input.config,
      simTimeMs: input.simTimeMs,
      encoderMm: input.encoderMm,
      groundTruth: input.groundTruth,
      frames: input.frames,
      observations: input.observations,
      results: input.results,
      metrics: input.metrics,
      simEvents: input.simEvents,
      pipelineEvents: input.pipelineEvents,
    }),
  );
  return deepFreeze(copy);
}
