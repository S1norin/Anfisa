import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { degToRad, mmToM } from '../domain/units';
import type { AreaScanCameraConfig, CameraState, ParcelState } from '../domain/types';
import type { SimConfig } from '../domain/config';
import { defaultConfig } from '../domain/config';
import { CameraRigScene, cameraRigToPerspective } from './cameraRig';
import { ParcelScene } from './parcel';
import { StationScene } from './stationScene';
import { CaptureRenderer } from '../capture/captureRenderer';
import { renderFullResFrame } from './pixelProbe';

/**
 * Diagnostics probe: expose the WebGLRenderer on `window.__anfisa` so
 * perf/leak checks (NFR-003/004/005) can read renderer.info (memory,
 * draw calls) from outside React, and the on-demand full-resolution pixel
 * probe on `window.__anfisaPixels` (issue #17, t4-zxing). Harmless in
 * production; overwritten on re-mount.
 */
function RendererProbe() {
  const state = useThree();
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__anfisa = { gl: state.gl, scene: state.scene, camera: state.camera };
    w.__anfisaPixels = {
      renderFullResFrame: (cameraId: string) =>
        renderFullResFrame(state.gl, state.scene, cameraId),
    };
    return () => {
      const cur = w.__anfisa as { gl?: unknown } | undefined;
      if (cur && cur.gl === state.gl) delete w.__anfisa;
      delete w.__anfisaPixels;
    };
  });
  return null;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/**
 * Operations 3D canvas (issue #11): station, camera status lights, and
 * live parcels with label decals; click a parcel (or a rig) to select.
 * Clicking empty space clears the parcel selection.
 */
export interface SceneCanvasProps {
  config?: SimConfig;
  /** Runtime per-rig states (defaults to IDLE/OFFLINE by `enabled`). */
  cameraStates?: Record<string, CameraState>;
  selectedCameraId?: string | null;
  onSelectCamera?: (id: string) => void;
  /** Live parcels (rendered with label decals + selection). */
  parcels?: ParcelState[];
  selectedParcelId?: string | null;
  onSelectParcel?: (id: string | null) => void;
  /** Render through the selected physical rig instead of the orbit camera. */
  cameraView?: boolean;
  /** Draw a lens → working-target rod on every rig (working distance). */
  showWorkingDistances?: boolean;
}

function RigViewCamera({ rig }: { rig: SimConfig['cameraRigs'][number] }) {
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);

  const camera = useMemo(() => {
    // Area-rig viewport (line-scan rigs have no frustum camera; t10).
    const next = cameraRigToPerspective(rig as AreaScanCameraConfig);
    // The lab viewport follows its available size. In the normal desktop
    // layout this matches the configured 16:9 preview, while remaining
    // usable on narrower screens.
    next.aspect = size.width / Math.max(1, size.height);
    next.updateProjectionMatrix();
    return next;
  }, [rig, size.width, size.height]);

  useLayoutEffect(() => {
    set({ camera });
  }, [camera, set]);

  return null;
}

/**
 * Selection highlight: a translucent box a touch larger than the parcel,
 * refreshed in place every render (parcel positions mutate each tick).
 */
function ParcelSelectionBox({ parcel }: { parcel: ParcelState }) {
  const spec = parcel.spec;
  const w = mmToM(spec.widthMm) + 0.02;
  const h = mmToM(spec.heightMm) + 0.02;
  const l = mmToM(spec.lengthMm) + 0.02;
  const geo = useMemo(() => new THREE.BoxGeometry(w, h, l), [w, h, l]);
  const x = mmToM(spec.lateralOffsetMm);
  const y = mmToM(spec.heightMm) / 2;
  const z = mmToM(parcel.frontZMm - spec.lengthMm / 2);
  return (
    <mesh geometry={geo} position={[x, y, z]} rotation={[0, degToRad(spec.yawDeg), 0]}>
      <meshBasicMaterial color="#4da3ff" transparent opacity={0.16} depthWrite={false} />
    </mesh>
  );
}

export function SceneCanvas({
  config = defaultConfig(),
  cameraStates,
  selectedCameraId = null,
  onSelectCamera,
  parcels = [],
  selectedParcelId = null,
  onSelectParcel,
  cameraView = false,
  showWorkingDistances = true,
}: SceneCanvasProps) {
  const selectedParcel = parcels.find((p) => p.parcelId === selectedParcelId) ?? null;
  const selectedCamera =
    config.cameraRigs.find((rig) => rig.id === selectedCameraId) ?? config.cameraRigs[0] ?? null;
  if (!hasWebGL()) {
    return (
      <div className="scene-canvas-fallback" data-testid="scene-canvas-fallback">
        3D view unavailable: WebGL is not supported in this browser.
      </div>
    );
  }

  return (
    <Canvas
      data-testid="scene-canvas"
      dpr={[1, 2]}
      camera={{ position: [2.4, 1.6, 3.4], fov: 45, near: 0.05, far: 100 }}
      onPointerMissed={() => onSelectParcel?.(null)}
    >
      <color attach="background" args={['#161a20']} />
      <RendererProbe />
      {cameraView && selectedCamera && <RigViewCamera rig={selectedCamera} />}
      <CaptureRenderer />
      <ambientLight intensity={0.22} />
      <directionalLight position={[4, 6, 3]} intensity={0.32} />
      <StationScene config={config} />
      {!cameraView && (
        <CameraRigScene
          rigs={config.cameraRigs}
          states={
            cameraStates ??
            Object.fromEntries(config.cameraRigs.map((r) => [r.id, r.enabled ? 'IDLE' : 'OFFLINE']))
          }
          selectedId={selectedCameraId}
          onSelect={onSelectCamera ?? (() => undefined)}
          showWorkingDistances={showWorkingDistances}
        />
      )}
      {parcels.map((p) => (
        <group
          key={p.parcelId}
          // No data-* props on R3F elements: applyProps treats dashed keys
          // as nested object paths and throws on instance.data.testid.
          onClick={(e) => {
            e.stopPropagation();
            onSelectParcel?.(p.parcelId);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <ParcelScene state={p} />
        </group>
      ))}
      {selectedParcel && <ParcelSelectionBox parcel={selectedParcel} />}
      {!cameraView && (
        <>
          <gridHelper args={[8, 40, '#2f3740', '#222831']} position={[0, -0.8, 1.1]} />
          <OrbitControls
            target={[0, 0.3, 1.1]}
            maxPolarAngle={Math.PI / 2 - 0.02}
            minDistance={0.4}
            maxDistance={12}
          />
        </>
      )}
    </Canvas>
  );
}
