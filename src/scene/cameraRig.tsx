/**
 * Camera rig scene (CAM-001, CAM-003): renders each configured reader as a
 * body + lens + frustum wireframe. Clicking a rig selects it for the
 * editor (issue #5). World unit at the render boundary is metres; the
 * domain keeps millimetres.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { frustumCornersMm, sensorIntrinsics } from '../domain/camera';
import type {
  AreaScanCameraConfig,
  CameraConfig,
  CameraState,
  LineScanCameraConfig,
} from '../domain/types';
import { FrustumLines } from './frustumHelper';

/** Millimetres → metres (render boundary only). */
const MM = 0.001;

/**
 * Area-rig layout (m): body + lens, the legacy CAM-001 shape. The lens
 * sits on the optical front face (local -Z, matching the rendered
 * half-turn applied in cameraRigToPerspective). Kept as a constant so
 * the line-rig extension (t8) cannot silently change the area rendering.
 */
export const AREA_RIG_LAYOUT = {
  bodyM: [0.09, 0.11, 0.06] as [number, number, number],
  lensM: [0.02, 0.025, 0.02, 24] as [number, number, number, number],
  lensPosM: [0, 0, -0.038] as [number, number, number],
  meshCount: 2,
} as const;

/** Build the PerspectiveCamera that a rig's intrinsics imply (CAM-003). */
export function cameraRigToPerspective(cfg: AreaScanCameraConfig): THREE.PerspectiveCamera {
  const intr = sensorIntrinsics(cfg.sensor);
  const cam = new THREE.PerspectiveCamera(
    intr.fovYDeg,
    intr.aspect,
    cfg.sensor.nearMm * MM,
    cfg.sensor.farMm * MM,
  );
  const p = cfg.pose.positionMm;
  const q = cfg.pose.quaternion;
  cam.position.set(p[0] * MM, p[1] * MM, p[2] * MM);
  // Domain cameras use an OpenCV-style +Z optical axis, while THREE.Camera
  // looks down local -Z. Rotate the camera half a turn in its local Y axis
  // so the rendered view follows the same optical axis as projection.ts.
  cam.quaternion
    .set(q[0], q[1], q[2], q[3])
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

const STATE_COLORS: Record<CameraState, string> = {
  OFFLINE: '#5b6472',
  IDLE: '#4f8cff',
  ARMED: '#ffd166',
  CAPTURING: '#ffb84f',
  PROCESSING: '#4fd0a0',
  FAULT: '#ff5c5c',
};

/** State → accent color, shared by area frusta and line markers (CAM-009). */
export function rigStateColor(state: CameraState): string {
  return STATE_COLORS[state];
}

/** Selection highlight, shared by area and line rigs. */
export function selectionEmissive(selected: boolean): { color: string; intensity: number } {
  return selected ? { color: '#ffb84f', intensity: 0.45 } : { color: '#000000', intensity: 0 };
}

/**
 * Line-scan rig layout in metres (render boundary). The housing is long
 * and narrow: its long axis is the sensor axis (local Y — line-scanner
 * poses are built with the belt width in local Y, see lookAtQuaternion
 * for the TOP/BOTTOM presets). The optical line marker sits on the
 * optical front face (local -Z, same side as the area lens). The scan
 * plane is a thin world-space slab at the encoder-synced scanPlaneZMm.
 * Exactly three meshes, constant for any sensor/encoder settings —
 * never one mesh per line.
 */
export interface LineRigLayout {
  /** Housing size (m): [narrow, sensor width + margin, depth]. */
  housingM: [number, number, number];
  /** Optical line marker size (m), a thin strip along the sensor axis. */
  lineMarkerM: [number, number, number];
  /** Optical line marker position in the rig's local space (m). */
  lineMarkerPosM: [number, number, number];
  /** Thin scan plane size (m) in world space. */
  scanPlaneSizeM: [number, number, number];
  /** Thin scan plane position in world space (m), Z = scanPlaneZMm. */
  scanPlanePosM: [number, number, number];
  /** Fixed mesh count: housing + marker + plane. */
  meshCount: number;
}

const LINE_HOUSING_MARGIN_M = 0.02; // per-side housing overhang past the sensor

export function lineRigLayout(rig: LineScanCameraConfig): LineRigLayout {
  const w = rig.line.fovWidthMm * MM; // scan-plane FOV, not the physical sensor
  const depth = 0.05;
  return {
    housingM: [0.06, w + 2 * LINE_HOUSING_MARGIN_M, depth],
    lineMarkerM: [0.012, w, 0.004],
    lineMarkerPosM: [0, 0, -(depth / 2 + 0.002)],
    scanPlaneSizeM: [w, 0.012, 0.004],
    scanPlanePosM: [
      rig.pose.positionMm[0] * MM,
      rig.pose.positionMm[1] * MM,
      rig.line.scanPlaneZMm * MM,
    ],
    meshCount: 3,
  };
}

interface RigMeshProps {
  rig: CameraConfig;
  state: CameraState;
  selected: boolean;
  onSelect: (id: string) => void;
}

function RigMesh({ rig, state, selected, onSelect }: RigMeshProps) {
  const body = useMemo(() => new THREE.BoxGeometry(...AREA_RIG_LAYOUT.bodyM), []);
  const lens = useMemo(() => new THREE.CylinderGeometry(...AREA_RIG_LAYOUT.lensM), []);
  useEffect(
    () => () => {
      body.dispose();
      lens.dispose();
    },
    [body, lens],
  );

  const p = rig.pose.positionMm;
  const q = rig.pose.quaternion;
  const color = rigStateColor(state);
  const emissive = selectionEmissive(selected);
  const isArea = rig.kind === 'AREA_SCAN';

  const lineLayout = useMemo(
    () => (isArea ? null : lineRigLayout(rig as LineScanCameraConfig)),
    [rig, isArea],
  );

  const cornersM = useMemo(
    () =>
      isArea
        ? frustumCornersMm(rig).map(
            (c) => [c[0] * MM, c[1] * MM, c[2] * MM] as [number, number, number],
          )
        : null,
    [rig, isArea],
  );

  const select = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect(rig.id);
  };

  return (
    <group>
      <group
        position={[p[0] * MM, p[1] * MM, p[2] * MM]}
        quaternion={[q[0], q[1], q[2], q[3]]}
        onClick={select}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        {isArea ? (
          <>
            <mesh geometry={body}>
              <meshStandardMaterial
                color="#2f3640"
                metalness={0.6}
                roughness={0.4}
                emissive={emissive.color}
                emissiveIntensity={emissive.intensity}
              />
            </mesh>
            <mesh
              geometry={lens}
              rotation={[Math.PI / 2, 0, 0]}
              position={AREA_RIG_LAYOUT.lensPosM}
            >
              <meshStandardMaterial color="#111827" metalness={0.3} roughness={0.2} />
            </mesh>
            {cornersM && (
              <FrustumLines cornersM={cornersM} color={color} opacity={rig.enabled ? 0.6 : 0.2} />
            )}
          </>
        ) : (
          lineLayout && (
            <>
              {/* Long narrow housing: sensor axis along local Y. */}
              <mesh>
                <boxGeometry args={lineLayout.housingM} />
                <meshStandardMaterial
                  color="#2f3640"
                  metalness={0.6}
                  roughness={0.4}
                  emissive={emissive.color}
                  emissiveIntensity={emissive.intensity}
                />
              </mesh>
              {/* Optical line marker on the front (optical) face. */}
              <mesh position={lineLayout.lineMarkerPosM}>
                <boxGeometry args={lineLayout.lineMarkerM} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
              </mesh>
            </>
          )
        )}
      </group>
      {/* Line scanners: world-space scan plane at the encoder-synced Z. */}
      {lineLayout && (
        <LineScanPlaneMarker
          layout={lineLayout}
          stateColor={color}
          enabled={rig.enabled}
          onSelect={select}
        />
      )}
    </group>
  );
}

/** Thin plane marking the line scanner's scan Z (world space, belt-normal). */
function LineScanPlaneMarker({
  layout,
  stateColor,
  enabled,
  onSelect,
}: {
  layout: LineRigLayout;
  stateColor: string;
  enabled: boolean;
  onSelect: (e: { stopPropagation: () => void }) => void;
}) {
  return (
    <mesh position={layout.scanPlanePosM} onClick={onSelect}>
      <boxGeometry args={layout.scanPlaneSizeM} />
      <meshStandardMaterial
        color={stateColor}
        emissive={stateColor}
        emissiveIntensity={0.35}
        transparent
        opacity={enabled ? 0.75 : 0.25}
      />
    </mesh>
  );
}

export interface CameraRigSceneProps {
  rigs: CameraConfig[];
  states: Record<string, CameraState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CameraRigScene({ rigs, states, selectedId, onSelect }: CameraRigSceneProps) {
  return (
    <>
      {rigs.map((r) => (
        <RigMesh
          key={r.id}
          rig={r}
          state={states[r.id] ?? 'OFFLINE'}
          selected={r.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
