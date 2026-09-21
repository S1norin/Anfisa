/**
 * Pixel-frame probe (t17, PIXEL_DECODER experiment): renders the live
 * scene from one rig at FULL SENSOR RESOLUTION into a transient FBO and
 * reads it back, so the Camera Lab can feed the synthetic pixel decoder
 * a frame in the same pixel space the geometry engine projects into
 * (physical sensor pixels — `projectedCornersPx` is in this space).
 *
 * Why full resolution: the display previews are downsampled (960×540),
 * where a 78 mm label at 1.1 m working distance is ~0.6 px/module —
 * below the ~1 px/module floor of any pixel decoder. A real camera
 * delivers sensor resolution; this experiment mirrors that.
 *
 * On-demand ONLY: the render + GPU readback (tens of MB) happen behind
 * the user's "Run pixel decode" click, never in the capture/decode hot
 * path (NFR-001). The transient target is disposed after each read.
 */
import * as THREE from 'three';
import { simStore } from '../store/simStore';
import type { PixelFrame, SensorRoi } from '../pipeline/pixelDecoder';
import { cameraRigToPerspective } from './cameraRig';

export interface FullResProbeFrame {
  frame: PixelFrame;
  /** The rig's static mask (undefined when the rig has no ROI). */
  roi: SensorRoi | undefined;
}

/**
 * Render the current scene from `cameraId` at the rig's sensor size and
 * return the pixels (RGBA, row-major) plus the rig's sensor ROI (the
 * explicit mask stage for the pixel path, t4-pixel). Null when the rig
 * is unknown.
 */
export function renderFullResFrame(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cameraId: string,
): FullResProbeFrame | null {
  const rig = simStore.sim.state.config.cameraRigs.find((r) => r.id === cameraId);
  // Full-res pixel probes are area-scan only; line scanners decode from
  // domain strip data (no pixels).
  if (!rig || rig.kind !== 'AREA_SCAN') return null;
  const w = rig.sensor.widthPx;
  const h = rig.sensor.heightPx;
  if (w <= 0 || h <= 0) return null;

  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cam = cameraRigToPerspective(rig);
  gl.setRenderTarget(rt);
  gl.clear();
  gl.render(scene, cam);
  gl.setRenderTarget(null);

  const data = new Uint8Array(w * h * 4);
  gl.readRenderTargetPixels(rt, 0, 0, w, h, data);
  rt.dispose();
  return {
    frame: { data, widthPx: w, heightPx: h },
    roi: rig.sensor.roi,
  };
}
