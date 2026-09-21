/**
 * Step 5: side-camera capture (t4-1).
 *
 * The parcel enters section 2: the six side camera directions appear in 3D
 * with the selected camera's cone emphasized. The right panel shows the six
 * captured 2D frames (manifest area assets) as thumbnails, one enlarged; the
 * camera chips switch the enlarged frame to reveal how the same label
 * changes with viewing angle (and that some angles see no label at all).
 *
 * Raw frames only — the 2D preparation stages land in step 6.
 */

import * as THREE from 'three';
import type { CaptureRecord, ReplayManifest } from './replayManifest';
import { stepIndexAt } from './playbackStore';

/** Stable display order of the six side cameras (matches SIDE_CAMERAS). */
export const SIDE_CAM_ORDER = [
  'cam-side-1',
  'cam-side-2',
  'cam-side-3',
  'cam-side-4',
  'cam-side-5',
  'cam-side-6',
] as const;

export type SideCamId = (typeof SIDE_CAM_ORDER)[number];

/**
 * Azimuth (deg, 0 = facing the parcel FRONT face, the travel side) and
 * mount per side camera — must stay in sync with SIDE_CAMERAS in
 * fixtures.ts and SIDE_CAM_VIEW in scripts/gen_hiw_assets.py.
 */
export const SIDE_CAM_POSE: Record<SideCamId, { azimuthDeg: number; low: boolean }> = {
  'cam-side-1': { azimuthDeg: 0, low: false },
  'cam-side-2': { azimuthDeg: 45, low: false },
  'cam-side-3': { azimuthDeg: 135, low: false },
  'cam-side-4': { azimuthDeg: 180, low: false },
  'cam-side-5': { azimuthDeg: 225, low: true },
  'cam-side-6': { azimuthDeg: 270, low: true },
};

/** Station z (m) of the side-camera ring — the section-2 capture point. */
export const SIDE_CAM_Z_M = 0.7;

/**
 * The six AREA captures of the current step, in SIDE_CAM_ORDER (null
 * outside step 5). Every side camera captures, so there is one record per
 * camera; cameras without a label in frame carry no candidate.
 */
export function sideCapturesAt(
  manifest: ReplayManifest,
  tMs: number,
): CaptureRecord[] | null {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, tMs);
  const step = manifest.steps[idx];
  if (step.step !== 5) return null;
  const caps = manifest.captures.filter((c) => c.kind === 'AREA_CAMERA');
  const bySensor = new Map(caps.map((c) => [c.sensorId, c]));
  return SIDE_CAM_ORDER.map((id) => bySensor.get(id)).filter(
    (c): c is CaptureRecord => c !== undefined,
  );
}

/** Raw (stages[0]) frame path of an area capture. */
export function rawFramePath(capture: CaptureRecord): string {
  return capture.stages[0].path;
}

/**
 * 3D highlight: the six side cameras as small boxes with view cones toward
 * the parcel; the selected camera's cone is emphasized. The ring is fixed at
 * SIDE_CAM_Z_M (section 2) — the parcel passes through it during step 5.
 */
export function SideCameraCaptureHighlight({
  selectedId,
  parcelTopMm = 220,
}: {
  selectedId: SideCamId;
  parcelTopMm?: number;
}) {
  const radius = 0.55;
  const targetY = parcelTopMm / 2000;
  return (
    <group
      name="side-camera-highlight"
      userData={{ selected: selectedId }}
      position={[0, 0, SIDE_CAM_Z_M]}
    >
      {SIDE_CAM_ORDER.map((id) => {
        const { azimuthDeg, low } = SIDE_CAM_POSE[id];
        const th = (azimuthDeg * Math.PI) / 180;
        const x = radius * Math.sin(th);
        const z = radius * Math.cos(th);
        const y = low ? 0.62 : 0.38;
        const selected = id === selectedId;
        // Cone points from the camera at the parcel center (origin of this
        // group): default cone axis is +Y, so rotate to face -local-Z...
        // simpler: position the cone between camera and target, aligned via
        // lookAt-equivalent quaternion.
        const dir = new THREE.Vector3(-x, targetY - y, -z);
        const len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        );
        return (
          <group key={id} position={[x, y, z]} userData={{ camera: id }}>
            {/* camera body */}
            <mesh>
              <boxGeometry args={[0.07, 0.05, 0.09]} />
              <meshBasicMaterial color={selected ? '#ffd866' : '#8b949e'} />
            </mesh>
            {/* view cone toward the parcel */}
            <mesh
              position={[-x * 0.42, (targetY - y) * 0.42, -z * 0.42]}
              quaternion={q}
            >
              <coneGeometry args={[0.05, len * 0.84, 16, 1, true]} />
              <meshBasicMaterial
                color={selected ? '#ffd866' : '#4d5560'}
                transparent
                opacity={selected ? 0.5 : 0.18}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * Right-panel step 5 content: six raw-frame thumbnails (chips), the
 * selected frame enlarged, and an honest per-angle note — cameras that saw
 * no label say so (no fabricated "label visible" claim).
 */
export function Step5SideCameras({
  manifest,
  timeMs,
  selectedId,
  onSelect,
}: {
  manifest: ReplayManifest;
  timeMs: number;
  selectedId: SideCamId;
  onSelect: (id: SideCamId) => void;
}) {
  const captures = sideCapturesAt(manifest, timeMs);
  if (!captures) {
    return (
      <div className="step5-side" data-testid="step5-no-capture">
        No side-camera capture in this step.
      </div>
    );
  }
  const selected = captures.find((c) => c.sensorId === selectedId) ?? captures[0];

  return (
    <div
      className="step5-side"
      data-testid="step5-side"
      data-capture-id={selected.captureId}
    >
      <p className="step5-caption">
        Six side cameras fire as the box crosses section 2 — the same label
        looks different from every angle (and some angles see no label at
        all).
      </p>
      <div className="step5-thumbs" role="group" aria-label="Side cameras">
        {captures.map((c) => (
          <button
            key={c.captureId}
            type="button"
            className={`step5-chip${c.sensorId === selectedId ? ' step5-chip-active' : ''}`}
            data-testid={`step5-chip-${c.sensorId}`}
            aria-pressed={c.sensorId === selectedId}
            onClick={() => onSelect(c.sensorId as SideCamId)}
            title={`${c.sensorId} · ${c.captureId}`}
          >
            <img
              src={rawFramePath(c)}
              alt={`${c.sensorId} frame`}
              data-testid={`step5-thumb-${c.sensorId}`}
            />
            <span>{c.sensorId.replace('cam-side-', 'cam ')}</span>
          </button>
        ))}
      </div>
      <figure className="step5-enlarged" data-testid="step5-enlarged">
        <img
          src={rawFramePath(selected)}
          alt={`${selected.sensorId} enlarged frame`}
          data-testid="step5-enlarged-img"
        />
        <figcaption data-testid="step5-enlarged-meta">
          <span>{selected.sensorId}</span>
          <span data-testid="step5-capture-id">{selected.captureId}</span>
          <span>
            encoder {selected.encoderSpanMm[0]} mm
          </span>
          {selected.candidate ? (
            <span data-testid="step5-label-visible">label visible</span>
          ) : (
            <span data-testid="step5-label-not-visible">
              no label in frame — out of view
            </span>
          )}
        </figcaption>
      </figure>
    </div>
  );
}
