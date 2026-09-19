import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { CameraState } from '../domain/types';
import type { SimConfig } from '../domain/config';
import { defaultConfig } from '../domain/config';
import { CameraRigScene } from './cameraRig';
import { StationScene } from './stationScene';
import { CaptureRenderer } from '../capture/captureRenderer';

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/**
 * Operations 3D canvas (issue #11 extends this with parcels, labels,
 * camera status, selection, and dimension overlays).
 */
export interface SceneCanvasProps {
  config?: SimConfig;
  /** Runtime per-rig states (defaults to IDLE/OFFLINE by `enabled`). */
  cameraStates?: Record<string, CameraState>;
  selectedCameraId?: string | null;
  onSelectCamera?: (id: string) => void;
}

export function SceneCanvas({
  config = defaultConfig(),
  cameraStates,
  selectedCameraId = null,
  onSelectCamera,
}: SceneCanvasProps) {
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
    >
      <color attach="background" args={['#161a20']} />
      <CaptureRenderer />
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 3]} intensity={1.1} />
      <StationScene config={config} />
      <CameraRigScene
        rigs={config.cameraRigs}
        states={
          cameraStates ??
          Object.fromEntries(
            config.cameraRigs.map((r) => [r.id, r.enabled ? 'IDLE' : 'OFFLINE']),
          )
        }
        selectedId={selectedCameraId}
        onSelect={onSelectCamera ?? (() => undefined)}
      />
      <gridHelper args={[8, 40, '#2f3740', '#222831']} position={[0, -0.8, 1.1]} />
      <OrbitControls
        target={[0, 0.3, 1.1]}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minDistance={0.4}
        maxDistance={12}
      />
    </Canvas>
  );
}
