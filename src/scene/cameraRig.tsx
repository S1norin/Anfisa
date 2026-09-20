/**
 * Camera rig scene (CAM-001, CAM-003): renders each configured reader as a
 * body + lens + frustum wireframe. Clicking a rig selects it for the
 * editor (issue #5). World unit at the render boundary is metres; the
 * domain keeps millimetres.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { frustumCornersMm, sensorIntrinsics } from '../domain/camera';
import type { CameraConfig, CameraState } from '../domain/types';
import { FrustumLines } from './frustumHelper';

/** Millimetres → metres (render boundary only). */
const MM = 0.001;

/** Build the PerspectiveCamera that a rig's intrinsics imply (CAM-003). */
export function cameraRigToPerspective(cfg: CameraConfig): THREE.PerspectiveCamera {
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

interface RigMeshProps {
  rig: CameraConfig;
  state: CameraState;
  selected: boolean;
  onSelect: (id: string) => void;
}

function RigMesh({ rig, state, selected, onSelect }: RigMeshProps) {
  const body = useMemo(() => new THREE.BoxGeometry(0.09, 0.11, 0.06), []);
  const lens = useMemo(() => new THREE.CylinderGeometry(0.02, 0.025, 0.02, 24), []);
  useEffect(
    () => () => {
      body.dispose();
      lens.dispose();
    },
    [body, lens],
  );

  const p = rig.pose.positionMm;
  const q = rig.pose.quaternion;
  const color = STATE_COLORS[state];

  const cornersM = useMemo(
    () =>
      frustumCornersMm(rig).map(
        (c) => [c[0] * MM, c[1] * MM, c[2] * MM] as [number, number, number],
      ),
    [rig],
  );

  return (
    <group
      position={[p[0] * MM, p[1] * MM, p[2] * MM]}
      quaternion={[q[0], q[1], q[2], q[3]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(rig.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      <mesh geometry={body}>
        <meshStandardMaterial
          color="#2f3640"
          metalness={0.6}
          roughness={0.4}
          emissive={selected ? '#ffb84f' : '#000000'}
          emissiveIntensity={selected ? 0.45 : 0}
        />
      </mesh>
      <mesh geometry={lens} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.038]}>
        <meshStandardMaterial color="#111827" metalness={0.3} roughness={0.2} />
      </mesh>
      <FrustumLines cornersM={cornersM} color={color} opacity={rig.enabled ? 0.6 : 0.2} />
    </group>
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
