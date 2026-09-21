/**
 * Step 1: parcel entry story (t2-3).
 *
 * The story parcel approaches the station entrance from -150 mm. During
 * step 1 the entrance photoeye is highlighted in 3D, the right panel
 * shows the explicit "acquisition arming — no image yet" state (nothing
 * is fabricated), and the encoder ruler advances with the manifest pose.
 * The always-on parcel chip stays masked ("awaiting entry") until the
 * parcel front actually crosses the entry photoeye plane (z = 0).
 */

import type { ReplayManifest, PoseKeyframe } from './replayManifest';
import { parcelFrontZAt } from './layout';
import { stepIndexAt } from './playbackStore';
import { lineScanHighlightAt } from './step2Capture';

/** Entry photoeye plane (station entry), mm. */
export const PHOTOEYE_Z_MM = 0;

export type KeyframeLike = readonly Pick<PoseKeyframe, 'tMs' | 'frontZMm'>[];

/** True once the parcel front has crossed the entry photoeye plane. */
export function hasCrossedPhotoeye(keyframes: KeyframeLike, tMs: number): boolean {
  return parcelFrontZAt(keyframes, tMs) >= PHOTOEYE_Z_MM;
}

/**
 * Which scene highlight is active at story time t (drives the 3D panel).
 * Step 1 highlights the entry photoeye; step 2 highlights the line-scan
 * capture (scan planes glow while the box crosses, bottom gap revealed);
 * later steps land their highlights with their content tasks.
 */
export function sceneHighlightAt(
  manifest: ReplayManifest,
  tMs: number,
): 'photoeye-entry' | 'line-scan' | null {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, tMs);
  if (manifest.steps[idx].sensorIds.includes('photoeye-entry')) return 'photoeye-entry';
  return lineScanHighlightAt(manifest, tMs) ? 'line-scan' : null;
}

/**
 * Right-panel step 1 content: arming state + encoder ruler + entry
 * status. Explicitly shows NO image (the first capture lands in step 2).
 */
export function Step1Entry({
  manifest,
  timeMs,
}: {
  manifest: ReplayManifest;
  timeMs: number;
}) {
  const frontZ = parcelFrontZAt(manifest.keyframes, timeMs);
  const entered = hasCrossedPhotoeye(manifest.keyframes, timeMs);
  const minZ = manifest.keyframes[0].frontZMm;
  const maxZ = manifest.keyframes[manifest.keyframes.length - 1].frontZMm;
  const pct =
    maxZ > minZ ? Math.min(100, Math.max(0, ((frontZ - minZ) / (maxZ - minZ)) * 100)) : 0;

  return (
    <div className="step1-entry" data-testid="step1-entry">
      <div className="step1-arming" data-testid="step1-arming">
        Acquisition arming — no image yet. The parcel is approaching the entry
        photoeye; the first capture happens in step 2.
      </div>
      <div className="step1-encoder" data-testid="step1-encoder">
        <span className="step1-encoder-label">encoder</span>
        <div className="step1-encoder-ruler" data-testid="step1-encoder-ruler">
          <div
            className="step1-encoder-marker"
            data-testid="step1-encoder-marker"
            style={{ left: `${pct}%` }}
          />
        </div>
        <span data-testid="step1-encoder-value">{Math.round(frontZ)} mm</span>
      </div>
      <div
        className={`step1-entry-status${entered ? ' step1-entry-status-in' : ''}`}
        data-testid={entered ? 'step1-entered' : 'step1-awaiting'}
      >
        {entered
          ? 'Parcel crossed the entry photoeye.'
          : 'Awaiting entry — entry photoeye armed.'}
      </div>
    </div>
  );
}

/**
 * 3D highlight overlay for the entry photoeye plane (z = 0): a glowing
 * plane across the belt plus a brighter beam, added on top of the
 * station's own (immutable) photoeye meshes.
 */
export function PhotoeyeEntryHighlight({ beltWidthMm }: { beltWidthMm: number }) {
  const w = beltWidthMm / 1000 + 0.08;
  return (
    <group name="photoeye-entry-highlight">
      <mesh position={[0, 0.225, 0]}>
        <boxGeometry args={[w, 0.45, 0.006]} />
        <meshBasicMaterial color="#f85149" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[w, 0.012, 0.012]} />
        <meshBasicMaterial color="#ff6b5e" transparent opacity={0.95} depthWrite={false} />
      </mesh>
    </group>
  );
}
