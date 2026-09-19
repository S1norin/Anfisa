/**
 * React wrapper: one parcel (box + optional tape + Code 128 label decals).
 *
 * The simulation mutates `ParcelState` in place (frontZMm, phase, times),
 * so the group is built ONCE per parcelId and the world transform is
 * refreshed on every render (the store version-ticks React each pump).
 *
 * World placement: parcel centre at
 *   x = lateralOffset, y = height/2 (bottom on the belt), z = frontZ - length/2
 * with yaw about the parcel centre (PAR-001).
 *
 * Disposes geometries, materials, and textures on unmount (NFR-003).
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { degToRad, mmToM } from '../domain/units';
import type { ParcelState } from '../domain/types';
import { buildLabelMesh } from './label';
import { createLabelTexture } from './labelTexture';
import { labelSeedFor } from './labelDamage';
import { createMaterial, TAPE_PRESET } from './materials';

const TAPE_THICKNESS_MM = 50;
const TAPE_HEIGHT_MM = 4;

function applyTransform(group: THREE.Group, state: ParcelState): void {
  const spec = state.spec;
  group.position.set(
    mmToM(spec.lateralOffsetMm),
    mmToM(spec.heightMm) / 2,
    mmToM(state.frontZMm - spec.lengthMm / 2),
  );
  group.rotation.y = degToRad(spec.yawDeg);
}

export function ParcelScene({ state }: { state: ParcelState }) {
  // spec is immutable after spawn, so the parcelId key is safe.
  const built = useMemo(() => {
    const spec = state.spec;
    const g = new THREE.Group();
    g.name = `parcel-${state.parcelId}`;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(
        mmToM(spec.widthMm),
        mmToM(spec.heightMm),
        mmToM(spec.lengthMm),
      ),
      createMaterial(spec.material),
    );
    body.name = 'parcel-body';
    body.userData.part = 'parcel-body';
    g.add(body);

    if (spec.tape) {
      const tape = new THREE.Mesh(
        new THREE.BoxGeometry(
          mmToM(TAPE_THICKNESS_MM),
          mmToM(TAPE_HEIGHT_MM),
          mmToM(spec.lengthMm) * 0.999,
        ),
        createMaterial(TAPE_PRESET),
      );
      tape.position.y = mmToM(spec.heightMm) / 2 + mmToM(TAPE_HEIGHT_MM) / 2 - 0.001;
      tape.name = 'tape-strip';
      tape.userData.part = 'tape';
      g.add(tape);
    }

    const textures: THREE.Texture[] = [];
    for (const label of spec.labels) {
      const texture = createLabelTexture(label.payload, {
        damage: label.damage,
        damageSeed: labelSeedFor(label.labelInstanceId),
      });
      textures.push(texture);
      g.add(buildLabelMesh(label, spec, texture));
    }

    applyTransform(g, state);

    const dispose = () => {
      g.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
            (m) => m.dispose(),
          );
        }
      });
      textures.forEach((t) => t.dispose());
    };

    return { group: g, dispose };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.parcelId]);

  // Dispose on unmount.
  useEffect(() => () => built.dispose(), [built]);

  // Refresh the transform every render (the parcel object is mutated in place).
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    applyTransform(built.group, stateRef.current);
  });

  return <primitive object={built.group} />;
}
