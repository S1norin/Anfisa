import * as THREE from 'three';
import type { SimConfig } from '../domain/config';
import { mmToM } from '../domain/units';

/**
 * Station geometry (issue #3). Pure THREE.Group builders so they run in
 * node tests (no WebGL). All config-driven — no hidden constants.
 *
 * Scene scale: 1 three.js unit = 1 metre (mm converted at the boundary).
 * y = 0 is the belt surface (parcel bottom plane).
 */

export const WORKING_DISTANCE_MM = 850;
export const GAP_OPENING_MM = 100;
export const RAIL_OFFSET_MM = 50; // rail centre offset beyond belt half-width
export const RAIL_WIDTH_MM = 50;
export const RAIL_HEIGHT_MM = 60;

export interface StationDimensions {
  beltWidthMm: number;
  stationLengthMm: number;
  workingDistanceMm: number;
  parcelWidthMm: number;
  parcelHeightMm: number;
  parcelLengthMm: number;
  /** Width of the bottom-face opening exposed to the bottom camera. */
  bottomOpeningMm: number;
  sortDistanceMm: number;
  /** z of the sort point, mm (entry = 0). */
  sortPointZMm: number;
}

export function getStationDimensions(cfg: SimConfig): StationDimensions {
  const railInnerMm =
    cfg.belt.widthMm / 2 + RAIL_OFFSET_MM - RAIL_WIDTH_MM / 2;
  const bottomOpeningMm =
    cfg.station.bottomTransfer === 'GAP'
      ? GAP_OPENING_MM
      : 2 * railInnerMm;
  return {
    beltWidthMm: cfg.belt.widthMm,
    stationLengthMm: cfg.station.lengthMm,
    workingDistanceMm: WORKING_DISTANCE_MM,
    parcelWidthMm: cfg.parcel.widthMm,
    parcelHeightMm: cfg.parcel.heightMm,
    parcelLengthMm: cfg.parcel.lengthMm,
    bottomOpeningMm,
    sortDistanceMm: cfg.station.sortDistanceMm,
    sortPointZMm: cfg.station.lengthMm + cfg.station.sortDistanceMm,
  };
}

type Part =
  | 'belt-deck'
  | 'side-rail'
  | 'leg'
  | 'photoeye'
  | 'sort-point'
  | 'enclosure';

interface DeckSpec {
  part: Part;
  /** z range in metres, inclusive [z0, z1]. */
  z0: number;
  z1: number;
}

function makeBox(
  part: Part,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 }),
  );
  mesh.position.set(x, y, z);
  mesh.name = name;
  mesh.userData.part = part;
  return mesh;
}

function deckSegments(cfg: SimConfig): DeckSpec[] {
  const L = mmToM(cfg.station.lengthMm);
  const deckFront = -0.4;
  const deckRear = L + 0.4;
  if (cfg.station.bottomTransfer === 'GAP') {
    const mid = L / 2;
    const gapHalf = mmToM(GAP_OPENING_MM) / 2;
    return [
      { part: 'belt-deck', z0: deckFront, z1: mid - gapHalf },
      { part: 'belt-deck', z0: mid + gapHalf, z1: deckRear },
    ];
  }
  // SIDE_GRIP: deck only outside the transfer zone [0, L].
  return [
    { part: 'belt-deck', z0: deckFront, z1: 0 },
    { part: 'belt-deck', z0: L, z1: deckRear },
  ];
}

export function buildStationGroup(cfg: SimConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = 'station';
  const W = mmToM(cfg.belt.widthMm);
  const L = mmToM(cfg.station.lengthMm);
  const sortZ = L + mmToM(cfg.station.sortDistanceMm);
  const deckThick = 0.05;

  // Belt decks
  for (const seg of deckSegments(cfg)) {
    const len = seg.z1 - seg.z0;
    if (len <= 0) continue;
    group.add(
      makeBox(
        seg.part,
        W,
        deckThick,
        len,
        0,
        -deckThick / 2,
        (seg.z0 + seg.z1) / 2,
        0x2b3138,
        'belt-deck',
      ),
    );
  }

  // Side-grip rails (SIDE_GRIP only) carry the parcel's sides through [0, L].
  if (cfg.station.bottomTransfer === 'SIDE_GRIP') {
    const railX = W / 2 + mmToM(RAIL_OFFSET_MM);
    const railH = mmToM(RAIL_HEIGHT_MM);
    for (const side of [-1, 1] as const) {
      group.add(
        makeBox(
          'side-rail',
          mmToM(RAIL_WIDTH_MM),
          railH,
          L,
          side * railX,
          railH / 2,
          L / 2,
          0x3d4650,
          `side-rail-${side < 0 ? 'L' : 'R'}`,
        ),
      );
    }
  }

  // Legs
  const legZs = [-0.3, L * 0.25, L * 0.5, L * 0.75, L + 0.3];
  for (const z of legZs) {
    for (const side of [-1, 1] as const) {
      group.add(
        makeBox('leg', 0.05, 0.8, 0.05, side * (W / 2 - 0.02), -0.4, z, 0x23282e, `leg`),
      );
    }
  }

  // Photoeyes at entry (z=0) and exit (z=L): emitter/receiver + beam.
  for (const [z, label] of [
    [0, 'entry'],
    [L, 'exit'],
  ] as const) {
    for (const side of [-1, 1] as const) {
      group.add(
        makeBox(
          'photoeye',
          0.04,
          0.04,
          0.04,
          side * (W / 2 + 0.04),
          0.2,
          z,
          0xd29922,
          `photoeye-${label}-${side < 0 ? 'L' : 'R'}`,
        ),
      );
    }
    const beam = makeBox('photoeye', W + 0.08, 0.004, 0.004, 0, 0.2, z, 0xf85149, `photoeye-${label}-beam`);
    (beam.material as THREE.MeshStandardMaterial).transparent = true;
    (beam.material as THREE.MeshStandardMaterial).opacity = 0.6;
    group.add(beam);
  }

  // Sort point: two posts + sign.
  for (const side of [-1, 1] as const) {
    group.add(
      makeBox('sort-point', 0.05, 0.9, 0.05, side * 0.45, 0.45, sortZ, 0x4da3ff, 'sort-post'),
    );
  }
  group.add(makeBox('sort-point', 1.0, 0.18, 0.03, 0, 0.95, sortZ, 0x1f6feb, 'sort-sign'));

  // Enclosure: top rails + end posts (visual context).
  const encH = 1.2;
  for (const side of [-1, 1] as const) {
    group.add(
      makeBox('enclosure', 0.04, encH, 0.04, side * (W / 2 + 0.12), encH / 2, 0, 0x2f3740, 'enc-post'),
    );
    group.add(
      makeBox('enclosure', 0.04, encH, 0.04, side * (W / 2 + 0.12), encH / 2, L, 0x2f3740, 'enc-post'),
    );
  }
  for (const side of [-1, 1] as const) {
    group.add(
      makeBox('enclosure', 0.04, 0.04, L, side * (W / 2 + 0.12), encH, L / 2, 0x2f3740, 'enc-rail'),
    );
  }

  group.updateMatrixWorld(true);
  return group;
}

/**
 * Ray query: is a point on the parcel bottom face visible from a camera
 * position, given only station geometry? (Used by AC-05 / issue #8.)
 */
export function isBottomPointVisible(
  cfg: SimConfig,
  pointMm: { x: number; y: number; z: number },
  cameraMm: { x: number; y: number; z: number },
): { visible: boolean; hitPart?: string; hitName?: string } {
  const group = buildStationGroup(cfg);
  const from = new THREE.Vector3(
    mmToM(cameraMm.x),
    mmToM(cameraMm.y),
    mmToM(cameraMm.z),
  );
  const to = new THREE.Vector3(mmToM(pointMm.x), mmToM(pointMm.y), mmToM(pointMm.z));
  const dir = to.clone().sub(from);
  const ray = new THREE.Raycaster(from, dir.normalize(), 0, dir.length());
  const hits = ray.intersectObjects(group.children, true);
  if (hits.length === 0) return { visible: true };
  const first = hits[0];
  const part = (first.object.userData.part ?? first.object.name) as string;
  return { visible: false, hitPart: part, hitName: first.object.name };
}
