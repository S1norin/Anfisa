import { Canvas } from '@react-three/fiber';

/**
 * Shared R3F canvas placeholder. Issue #3 wires in the station geometry.
 * The canvas is intentionally empty for the scaffold (issue #1).
 *
 * Renders a fallback panel when WebGL is unavailable (also exercised in jsdom
 * tests where no GL context exists).
 */

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

export function SceneCanvas() {
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
      camera={{ position: [1.5, 1.2, 2.2], fov: 50, near: 0.001, far: 100 }}
      className="scene-canvas"
    >
      <color attach="background" args={['#101418']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={0.8} />
    </Canvas>
  );
}
