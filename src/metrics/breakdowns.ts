/**
 * Breakdown metrics (MET-007): read rates sliced by camera, face, material,
 * label rotation, PPM band, incidence-angle band, and failure reason.
 *
 * Every row is a pure function of per-observation data (no ground truth is
 * needed beyond "was this observation decoded"), so the same rows drive the
 * Operations view (issue #11) and the run record (issue #10).
 */

/** One breakdown row: read rate for a slice key. */
export interface BreakdownRow {
  key: string;
  /** Observations in this slice. */
  total: number;
  /** Decoded observations in this slice. */
  decoded: number;
  /** decoded / total (0 for an empty slice). */
  readRate: number;
}

interface SliceItem {
  key: string;
  decoded: boolean;
}

/**
 * Group observations by slice key and compute the per-key read rate.
 * Rows are sorted by key for stable output.
 */
export function breakdownBy(items: SliceItem[]): BreakdownRow[] {
  const by = new Map<string, { total: number; decoded: number }>();
  for (const item of items) {
    const row = by.get(item.key) ?? { total: 0, decoded: 0 };
    row.total += 1;
    if (item.decoded) row.decoded += 1;
    by.set(item.key, row);
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, row]) => ({
      key,
      total: row.total,
      decoded: row.decoded,
      readRate: row.total === 0 ? 0 : row.decoded / row.total,
    }));
}

/** PPM bands (MET-007): coarse buckets of projected pixels per module. */
export function ppmBand(ppm: number): string {
  if (ppm < 2) return '<2';
  if (ppm < 3) return '2-3';
  if (ppm < 5) return '3-5';
  return '>=5';
}

/** Incidence-angle bands (degrees, MET-007). */
export function angleBand(deg: number): string {
  if (deg < 20) return '<20';
  if (deg < 35) return '20-35';
  if (deg < 60) return '35-60';
  return '>=60';
}

/**
 * Label-rotation bands (degrees, MET-007). Rotation is folded into [0,180)
 * (a barcode has 180° symmetry) then bucketed in 45° steps.
 */
export function rotationBand(deg: number): string {
  const norm = ((deg % 180) + 180) % 180;
  const idx = Math.min(3, Math.floor(norm / 45));
  return `${idx * 45}-${idx * 45 + 45}`;
}
