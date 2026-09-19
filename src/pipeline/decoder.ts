/**
 * Deterministic decode stage (PIPE-006 `decode`).
 *
 * The seeded quality model (issue #8) is the SOLE arbiter of success: the
 * decoder never consults ground truth. It only reads the observation's
 * seeded quality decision and the content the synthetic frame encodes.
 * Identical config + seed + frame → identical decision (NFR-006).
 */

import type { LabelObservationResult } from '../observation/observationEngine';

/** Content the frame carries for one label (what the pixels encode). */
export interface FrameLabelContent {
  labelInstanceId: string;
  payload: string;
}

export interface DecodeResult {
  labelInstanceId: string;
  decoded: boolean;
  /** Only present when the quality model admitted the observation. */
  decodedPayload?: string;
  /** Observation confidence (0 when not decoded). */
  confidence: number;
  /** Reason codes carried from the observation (audit). */
  reasons: string[];
}

export function decodeObservation(
  obs: LabelObservationResult,
  frame: FrameLabelContent,
): DecodeResult {
  const decoded = obs.qualityPassed;
  return {
    labelInstanceId: obs.labelInstanceId,
    decoded,
    decodedPayload: decoded ? frame.payload : undefined,
    confidence: decoded ? obs.confidence : 0,
    reasons: obs.reasons,
  };
}
