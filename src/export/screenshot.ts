/**
 * PNG export for the schema view (issue #13, AC-09). The canvas is created
 * with `preserveDrawingBuffer: true`, so a plain re-render + toDataURL is a
 * faithful capture of the on-screen frame (annotation sprites included —
 * they are GL content, not DOM).
 */

import type * as THREE from 'three';

/**
 * Render the current frame and return it as a PNG blob. Returns null when
 * the GL context is unavailable (e.g. jsdom test environment).
 */
export function exportPng(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<Blob | null> {
  try {
    gl.render(scene, camera);
    const dataUrl = gl.domElement.toDataURL('image/png');
    const blob = dataUrlToBlob(dataUrl);
    return Promise.resolve(blob);
  } catch {
    return Promise.resolve(null);
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const mime = /:(.*?)(;|$)/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
