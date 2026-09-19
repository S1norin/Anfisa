/**
 * Frustum wireframe helper (CAM-003): draws the 12 edges of a camera's
 * near/far view volume. Corners come from domain/camera.ts as an ordered
 * array (near plane first, then far plane, both CCW from the camera side).
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

const EDGE_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0], // near plane
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4], // far plane
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // connectors
];

export interface FrustumLinesProps {
  /** 8 corners in world metres, near-then-far ordering. */
  cornersM: [number, number, number][];
  color?: string;
  opacity?: number;
}

export function FrustumLines({
  cornersM,
  color = '#4f8cff',
  opacity = 0.7,
}: FrustumLinesProps) {
  const segments = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(EDGE_PAIRS.length * 6);
    EDGE_PAIRS.forEach(([a, b], i) => {
      const ca = cornersM[a];
      const cb = cornersM[b];
      positions.set([ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]], i * 6);
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    });
    return new THREE.LineSegments(geometry, material);
  }, [cornersM, color, opacity]);

  // Dispose both the unmounted segments and the ones replaced by a re-edit.
  useEffect(() => {
    return () => {
      segments.geometry.dispose();
      (segments.material as THREE.Material).dispose();
    };
  }, [segments]);

  return <primitive object={segments} />;
}
