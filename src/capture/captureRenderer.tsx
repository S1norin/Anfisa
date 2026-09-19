import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { frameBuffer } from './frameBuffer';
import { PingPongPool } from './pingpong';
import { ArtifactPass } from './artifactPass';
import { frameArtifacts } from './imageFormation';
import type { PreviewMode } from './imageFormation';
import { cameraRigToPerspective } from '../scene/cameraRig';
import { useSim } from '../store/simStore';
import type { FrameObservation } from '../domain/types';

/**
 * App-wide capture targets (CAM-006, NFR-003): a ping-pong PAIR of
 * preview-size targets per capturing camera, reused across frames,
 * disposed on camera removal and on unmount.
 */
const pool = new PingPongPool();
const pass = new ArtifactPass();

/**
 * Capture renderer (CAM-006, CAM-007, issue #6, IMG-005..IMG-012):
 * consumes CAMERA_CAPTURED domain events, renders the live scene from each
 * capturing camera into a clean preview target, degrades it with the
 * artifact pass (visual side of the image-formation model), then pushes
 * full FrameObservation metadata + the degraded texture into the bounded
 * frame buffer.
 *
 * Runs inside <Canvas> so it has the r3f renderer; returns null.
 */
export function CaptureRenderer() {
  const sim = useSim();
  const { scene, gl } = useThree();
  const consumedRef = useRef(0);
  const lastRunIdRef = useRef(sim.state.runId);

  useFrame(() => {
    const state = sim.state;

    // Run reset: fresh audit identity — drop stale frames/targets.
    if (state.runId !== lastRunIdRef.current) {
      lastRunIdRef.current = state.runId;
      frameBuffer.clear();
      pool.dispose();
      consumedRef.current = 0;
    }

    // State rebuilds shrink the event array (reset) — rewind the cursor.
    if (state.events.length < consumedRef.current) consumedRef.current = 0;

    while (consumedRef.current < state.events.length) {
      const ev = state.events[consumedRef.current++];
      if (ev.type !== 'CAMERA_CAPTURED') continue;
      const rig = state.config.cameraRigs.find((r) => r.id === ev.cameraId);
      if (!rig) continue;

      const { src, dst } = pool.acquire(
        rig.id,
        rig.preview.widthPx,
        rig.preview.heightPx,
      );
      const cam = cameraRigToPerspective(rig);
      gl.setRenderTarget(src);
      gl.clear();
      gl.render(scene, cam);

      const candidates = ev.candidateParcelIds
        .map((id) => state.parcels.get(id))
        .filter((p): p is NonNullable<typeof p> => p != null);

      const frameId = `f-${rig.id}-${ev.simTimeMs}`;
      const artifacts = frameArtifacts(
        rig,
        candidates,
        state.config.belt.speedMmPerSec,
        frameId,
        previewMode.current,
      );

      pass.setParams(
        artifacts.visual,
        rig.preview.widthPx,
        rig.preview.heightPx,
        ev.simTimeMs / 1000,
      );
      pass.render(gl, src, dst);
      gl.setRenderTarget(null);

      const frame: FrameObservation = {
        frameId,
        runId: state.runId,
        cameraId: rig.id,
        cameraState: state.cameraStates[rig.id] ?? 'CAPTURING',
        simTimeMs: ev.simTimeMs,
        encoderPositionMm: state.encoderMm,
        cameraSnapshot: structuredClone(rig),
        preview: {
          widthPx: rig.preview.widthPx,
          heightPx: rig.preview.heightPx,
          textureRef: `rt-${rig.id}`,
        },
        candidateParcelIds: ev.candidateParcelIds,
        // Geometry-model labels and decoding land in issue #8.
        labels: [],
        processingMode: 'GEOMETRY_MODEL',
      };
      frameBuffer.push(frame, dst);
    }
  });

  // Dispose targets of cameras removed from the config (NFR-003).
  useEffect(() => {
    const live = new Set(sim.state.config.cameraRigs.map((r) => r.id));
    for (const id of pool.keys()) {
      if (!live.has(id)) {
        frameBuffer.removeCamera(id);
        pool.release(id);
      }
    }
  });

  useEffect(() => {
    return () => {
      pool.dispose();
      pass.dispose();
    };
  }, []);

  return null;
}

// Shared preview mode, mutable by the operations UI (IMG-012) without
// re-mounting the canvas: setPreviewMode() / getPreviewMode().
export const previewMode: { current: PreviewMode } = { current: 'PHYSICAL' };
export function setPreviewMode(m: PreviewMode): void {
  previewMode.current = m;
}
