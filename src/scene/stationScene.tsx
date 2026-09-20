import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SimConfig } from '../domain/config';
import { buildStationGroup } from './stationGeometry';

/**
 * React wrapper around the pure station group builder. Disposes GPU
 * resources on unmount/config change (NFR-003).
 *
 * `schematic` (schema view, issue #13): swaps every standard material for a
 * flat unlit MeshBasicMaterial with desaturated colour — low-clutter, cheap
 * to render, and independent of lighting so orthographic dimension views
 * stay readable.
 */
export function StationScene({
  config,
  schematic = false,
}: {
  config: SimConfig;
  schematic?: boolean;
}) {
  const group = useMemo(() => buildStationGroup(config), [config]);

  useEffect(() => {
    // Every material the group uses across its lifetime — originals plus
    // any schematic replacements — so unmount never leaks (NFR-003).
    const toDispose: THREE.Material[] = [];
    group.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const originals = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      toDispose.push(...originals);
      if (schematic) {
        for (const m of originals) {
          const c = new THREE.Color().copy(m.color);
          // Desaturate toward the background so annotations dominate.
          const hsl = { h: 0, s: 0, l: 0 };
          c.getHSL(hsl);
          c.setHSL(hsl.h, hsl.s * 0.35, Math.min(0.45, hsl.l * 0.8 + 0.08));
          const flat = new THREE.MeshBasicMaterial({
            color: c,
            transparent: m.transparent,
            opacity: m.opacity,
          });
          mesh.material = flat;
          toDispose.push(flat);
        }
      }
    });
    return () => {
      group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry.dispose();
        }
      });
      toDispose.forEach((m) => m.dispose());
    };
  }, [group, schematic]);

  return <primitive object={group} />;
}
