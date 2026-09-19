import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { frameBuffer } from './frameBuffer';
import { RenderTargetPool } from './renderTargets';
import { cameraRigToPerspective } from '../scene/cameraRig';
import { useSim } from '../store/simStore';
import type { FrameObservation } from '../domain/types';

/**
 * App-wide capture targets (CAM-006, NFR-003): one preview-size target per
 * capturing camera, reused across frames, disposed on camera removal and on
 * unmount.
 */
const pool = new RenderTargetPool();

/**
 * Capture renderer (CAM-006, CAM-007, issue #6): consumes CAMERA_CAPTURED
 * domain events and renders the live scene from each capturing camera into
 * a pooled preview target, then pushes full FrameObservation metadata into
 * the bounded frame buffer.
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

      const rt = pool.acquire(
        rig.id,
        rig.preview.widthPx,
        rig.preview.heightPx,
      );
      const cam = cameraRigToPerspective(rig);
      gl.render(scene, cam);

      const frame: FrameObservation = {
        frameId: `f-${rig.id}-${ev.simTimeMs}`,
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
      frameBuffer.push(frame, rt);
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
    return () => pool.dispose();
  }, []);

  return null;
}
