/**
 * JSON export/import formats (issue #15, AC-10, CFG-003, CFG-007).
 *
 * Three envelope kinds, all plain JSON (no Maps/classes, JSON-round-trip
 * safe):
 *
 *   anfisa-config   — a versioned SimConfig for import/export (CFG-007:
 *                     the configVersion gate rejects unknown future
 *                     versions instead of guessing).
 *   anfisa-run      — the full immutable RunRecord (MET-008 audit trail):
 *                     config + config version, seed, ground truth, camera
 *                     snapshots (frame metadata), observations, results,
 *                     and every displayed metric value.
 *   anfisa-observations — just the observation audit log (one row per
 *                     label observation per frame).
 */

import { CONFIG_VERSION, migrateConfigToLatest, validateConfig, type SimConfig } from '../domain/config';
import type { SimEvent } from '../domain/types';
import type { SimStore } from '../store/simStore';
import type { RunMetrics } from '../metrics/metrics';
import {
  buildRunRecord,
  type RunFrameMeta,
  type RunGroundTruthParcel,
  type RunObservationMeta,
  type RunRecord,
} from '../metrics/runRecord';

export const RUN_RECORD_VERSION = 1;

export const CONFIG_KIND = 'anfisa-config';
export const RUN_KIND = 'anfisa-run';
export const OBSERVATIONS_KIND = 'anfisa-observations';

/** Versioned config envelope (CFG-007). */
export interface ConfigEnvelope {
  kind: typeof CONFIG_KIND;
  configVersion: number;
  config: SimConfig;
}

/** Full run record envelope (AC-10). */
export interface RunEnvelope {
  kind: typeof RUN_KIND;
  recordVersion: number;
  configVersion: number;
  record: RunRecord;
}

/** Observation-log envelope (AC-10). */
export interface ObservationsEnvelope {
  kind: typeof OBSERVATIONS_KIND;
  runId: string;
  seed: number;
  observations: readonly RunObservationMeta[];
}

/** Serialize a config for export (pretty-printed). */
export function configToJson(cfg: SimConfig): string {
  const envelope: ConfigEnvelope = {
    kind: CONFIG_KIND,
    configVersion: CONFIG_VERSION,
    config: cfg,
  };
  return JSON.stringify(envelope, null, 2);
}

export type ConfigImportResult =
  | { ok: true; config: SimConfig }
  | { ok: false; errors: string[] };

/**
 * Parse + validate an exported config file (CFG-003/CFG-007):
 *  1. JSON must parse;
 *  2. `kind` must be `anfisa-config`;
 *  3. `configVersion` must be a supported version (v2 is migrated to v3;
 *     unknown future versions are rejected, not guessed);
 *  4. the config must pass the full CFG-001 validation.
 */
export function parseConfigImport(text: string): ConfigImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${String(e)}`] };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { kind?: unknown }).kind !== CONFIG_KIND
  ) {
    return { ok: false, errors: [`not an ${CONFIG_KIND} file (missing/unknown "kind")`] };
  }
  const env = parsed as ConfigEnvelope;
  if (env.configVersion !== 2 && env.configVersion !== CONFIG_VERSION) {
    return {
      ok: false,
      errors: [
        `configVersion ${env.configVersion} is not supported (this build reads ${CONFIG_VERSION} and imports v2)`,
      ],
    };
  }
  const migrated = migrateConfigToLatest(env.config);
  if (!migrated) {
    return { ok: false, errors: ['config could not be migrated to the latest shape'] };
  }
  const errors = validateConfig(migrated);
  if (errors.length > 0) {
    return { ok: false, errors: errors.map((e) => `${e.path}: ${e.message}`) };
  }
  return { ok: true, config: migrated };
}

/** Serialize a full run record (AC-10: config version, seed, ground truth, camera snapshots, observations, results, metrics). */
export function runRecordToJson(record: RunRecord): string {
  const envelope: RunEnvelope = {
    kind: RUN_KIND,
    recordVersion: RUN_RECORD_VERSION,
    configVersion: CONFIG_VERSION,
    record,
  };
  return JSON.stringify(envelope, null, 2);
}

/** Serialize the observation audit log (AC-10). */
export function observationsToJson(
  runId: string,
  seed: number,
  observations: readonly RunObservationMeta[],
): string {
  const envelope: ObservationsEnvelope = {
    kind: OBSERVATIONS_KIND,
    runId,
    seed,
    observations,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Camera-snapshot frames from the live event log: one RunFrameMeta per
 * CAMERA_CAPTURED event, with the encoder position replayed from the
 * SPEED_CHANGED log (exact — the encoder integrates speed per domain step,
 * and events fire at step boundaries after the integration).
 */
export function framesFromEvents(
  events: readonly SimEvent[],
  initialSpeedMmPerSec: number,
): RunFrameMeta[] {
  let speed = initialSpeedMmPerSec;
  let tPrev = 0;
  let posMm = 0;
  const frames: RunFrameMeta[] = [];
  for (const ev of events) {
    if (ev.type === 'SPEED_CHANGED') {
      posMm += (speed * (ev.simTimeMs - tPrev)) / 1000;
      speed = ev.toMmPerSec;
      tPrev = ev.simTimeMs;
    } else if (ev.type === 'CAMERA_CAPTURED') {
      posMm += (speed * (ev.simTimeMs - tPrev)) / 1000;
      tPrev = ev.simTimeMs;
      frames.push({
        frameId: `${ev.cameraId}@${ev.simTimeMs}`,
        cameraId: ev.cameraId,
        simTimeMs: ev.simTimeMs,
        encoderMm: Math.round(posMm * 100) / 100,
        candidateParcelIds: ev.candidateParcelIds,
        processingMode: 'GEOMETRY_MODEL',
      });
    }
  }
  return frames;
}

/**
 * Build the immutable run record from a LIVE store (the store has no
 * frame log, so frames are replayed from the event log; everything else
 * mirrors the headless driver so live and headless records are
 * byte-identical for the same step sequence, NFR-006).
 */
export function buildLiveRunRecord(store: SimStore, metrics: RunMetrics): RunRecord {
  const s = store.sim.state;
  const retiredIds = new Set(s.finalized.map((f) => f.parcelId));
  const groundTruth: RunGroundTruthParcel[] = [
    ...s.finalized.map((f) => ({
      parcelId: f.parcelId,
      spec: f.spec,
      spawnSimTimeMs: f.spawnSimTimeMs,
      entrySimTimeMs: f.entrySimTimeMs,
      exitSimTimeMs: f.exitSimTimeMs,
      sortSimTimeMs: f.sortSimTimeMs,
    })),
    ...[...s.parcels.values()]
      .filter((p) => !retiredIds.has(p.parcelId))
      .map((p) => ({
        parcelId: p.parcelId,
        spec: p.spec,
        spawnSimTimeMs: p.spawnSimTimeMs,
        entrySimTimeMs: p.entrySimTimeMs ?? undefined,
        exitSimTimeMs: p.exitSimTimeMs ?? undefined,
        sortSimTimeMs: p.sortSimTimeMs ?? undefined,
      })),
  ];
  return buildRunRecord({
    runId: s.runId,
    seed: s.config.seed,
    // Live captures always run the analytic geometry model (t4-labeling).
    processingMode: 'GEOMETRY_MODEL',
    config: s.config,
    simTimeMs: s.simTimeMs,
    encoderMm: s.encoderMm,
    groundTruth,
    frames: framesFromEvents(s.events, s.config.belt.speedMmPerSec),
    observations: store.liveObservations,
    results: store.results,
    metrics,
    simEvents: s.events,
    pipelineEvents: store.pipelineEvents,
  });
}
