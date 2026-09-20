/**
 * Latency metrics (MET-006): percentile summary of per-stage latencies.
 *
 * Stages measured in sim time (deterministic, NFR-006):
 *  - captureToDecodeMs: capture frame → decode decision. In the headless
 *    driver both happen in the same 5 ms domain step, so this stage is 0 by
 *    construction; it becomes meaningful when a live app queues frames.
 *  - entryToResultMs: photoeye entry → finalized result.
 *  - exitToResultMs: photoeye exit → finalized result.
 *  - exitToAckMs: photoeye exit → simulated PLC ACK.
 */

/** Percentile summary of a latency sample set (ms). */
export interface Percentiles {
  /** Number of samples. */
  n: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Nearest-rank percentiles. Empty input → all zeros. Deterministic.
 */
export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number): number => {
    const idx = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[Math.min(idx, sorted.length) - 1];
  };
  return { n: sorted.length, p50: rank(50), p95: rank(95), p99: rank(99) };
}

/** The four latency stages reported by a run (MET-006). */
export type LatencyStage =
  | 'captureToDecodeMs'
  | 'entryToResultMs'
  | 'exitToResultMs'
  | 'exitToAckMs';

export type LatencySummary = Record<LatencyStage, Percentiles>;

/** Build the four-stage summary from per-stage sample arrays. */
export function latencySummary(samples: Record<LatencyStage, number[]>): LatencySummary {
  return {
    captureToDecodeMs: percentiles(samples.captureToDecodeMs),
    entryToResultMs: percentiles(samples.entryToResultMs),
    exitToResultMs: percentiles(samples.exitToResultMs),
    exitToAckMs: percentiles(samples.exitToAckMs),
  };
}
