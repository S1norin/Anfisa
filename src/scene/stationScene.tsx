import { useEffect, useMemo } from 'react';
import type * as THREE from 'three';
import type { SimConfig } from '../domain/config';
import { buildStationGroup } from './stationGeometry';

/**
 * React wrapper around the pure station group builder. Disposes GPU
 * resources on unmount/config change (NFR-003).
 */
export function StationScene({ config }: { config: SimConfig }) {
  const group = useMemo(() => buildStationGroup(config), [config]);

  useEffect(() => {
    return () => {
      group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
            (m) => m.dispose(),
          );
        }
      });
    };
  }, [group]);

  return <primitive object={group} />;
}
