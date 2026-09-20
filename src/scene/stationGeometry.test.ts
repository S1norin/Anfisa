import * as THREE from 'three';
import { defaultConfig } from '../domain/config';
import {
  GAP_OPENING_MM,
  RAIL_OFFSET_MM,
  RAIL_WIDTH_MM,
  WORKING_DISTANCE_MM,
  buildStationGroup,
  getStationDimensions,
  isBottomPointVisible,
} from './stationGeometry';

function findParts(group: THREE.Group, part: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o.userData.part === part) out.push(o);
  });
  return out;
}

describe('station dimensions (§4 defaults)', () => {
  it('exposes the plan defaults', () => {
    const d = getStationDimensions(defaultConfig());
    expect(d.beltWidthMm).toBe(650);
    expect(d.stationLengthMm).toBe(2200);
    expect(d.workingDistanceMm).toBe(WORKING_DISTANCE_MM);
    expect(d.parcelWidthMm).toBe(400);
    expect(d.parcelHeightMm).toBe(400);
    expect(d.parcelLengthMm).toBe(600);
    expect(d.sortDistanceMm).toBe(1250);
    expect(d.sortPointZMm).toBe(3450);
  });

  it('bottom opening: 100 mm in GAP mode, rail span in SIDE_GRIP', () => {
    const gap = defaultConfig();
    gap.station.bottomTransfer = 'GAP';
    expect(getStationDimensions(gap).bottomOpeningMm).toBe(GAP_OPENING_MM);

    const grip = defaultConfig(); // SIDE_GRIP default
    expect(grip.station.bottomTransfer).toBe('SIDE_GRIP');
    const expected = 2 * (650 / 2 + RAIL_OFFSET_MM - RAIL_WIDTH_MM / 2);
    expect(getStationDimensions(grip).bottomOpeningMm).toBe(expected);
  });
});

describe('station geometry builder', () => {
  it('places photoeyes at entry z=0 and exit z=2200', () => {
    const group = buildStationGroup(defaultConfig());
    const entry = group.children.filter((c) => c.name === 'photoeye-entry-beam');
    const exit = group.children.filter((c) => c.name === 'photoeye-exit-beam');
    expect(entry).toHaveLength(1);
    expect(exit).toHaveLength(1);
    expect(entry[0].position.z).toBeCloseTo(0, 6);
    expect(exit[0].position.z).toBeCloseTo(2.2, 6);
  });

  it('places the sort point at z = 2200 + 1250 mm', () => {
    const group = buildStationGroup(defaultConfig());
    const sign = group.children.find((c) => c.name === 'sort-sign');
    expect(sign).toBeDefined();
    expect(sign!.position.z).toBeCloseTo(3.45, 6);
  });

  it('shows the controlled-light enclosure with roof and side fixtures', () => {
    const group = buildStationGroup(defaultConfig());
    expect(findParts(group, 'enclosure-panel')).toHaveLength(3);
    expect(findParts(group, 'station-light')).toHaveLength(7);
    expect(findParts(group, 'belt-edge')).toHaveLength(4);
  });

  it('SIDE_GRIP: no belt deck under the transfer zone, rails present', () => {
    const grip = defaultConfig();
    const group = buildStationGroup(grip);
    const decks = findParts(group, 'belt-deck');
    // Both deck segments must stop at/after z=0 / start at/before z=2.2:
    // i.e. no deck segment overlaps z ∈ (0, 2.2).
    for (const deck of decks) {
      const box = new THREE.Box3().setFromObject(deck);
      if (box.min.z >= 0) {
        // Rear deck: starts at the exit, never enters the transfer zone.
        expect(box.min.z).toBeGreaterThanOrEqual(2.2 - 1e-6);
      } else {
        // Front deck: upstream of entry only.
        expect(box.max.z).toBeLessThanOrEqual(1e-6);
      }
    }
    // Both deck positions exist (front upstream + rear downstream).
    expect(decks.length).toBeGreaterThanOrEqual(2);
    expect(findParts(group, 'side-rail')).toHaveLength(2);
    // Rails sit beyond the belt edge.
    const rails = findParts(group, 'side-rail');
    for (const rail of rails) {
      expect(Math.abs(rail.position.x)).toBeCloseTo(0.375, 6);
    }
  });

  it('GAP: single 100 mm opening in the deck at mid-station', () => {
    const gap = defaultConfig();
    gap.station.bottomTransfer = 'GAP';
    const group = buildStationGroup(gap);
    const decks = findParts(group, 'belt-deck');
    expect(decks).toHaveLength(2);
    const boxes = decks
      .map((d) => new THREE.Box3().setFromObject(d))
      .sort((a, b) => a.min.z - b.min.z);
    const gapStart = boxes[0].max.z;
    const gapEnd = boxes[1].min.z;
    expect(gapEnd - gapStart).toBeCloseTo(0.1, 6);
    expect((gapStart + gapEnd) / 2).toBeCloseTo(1.1, 6);
    expect(findParts(group, 'side-rail')).toHaveLength(0);
  });
});

describe('bottom-face visibility (AC-05 / issue #8)', () => {
  // Bottom camera 850 mm below the parcel bottom face, parcel centred at z=500.
  const point = { x: 0, y: 0, z: 500 };
  const camera = { x: 0, y: -850, z: 500 };

  it('SIDE_GRIP: bottom face is visible (no deck under the transfer zone)', () => {
    const grip = defaultConfig();
    expect(grip.station.bottomTransfer).toBe('SIDE_GRIP');
    const res = isBottomPointVisible(grip, point, camera);
    expect(res.visible).toBe(true);
  });

  it('GAP: bottom face is occluded away from the 100 mm opening', () => {
    const gap = defaultConfig();
    gap.station.bottomTransfer = 'GAP';
    const res = isBottomPointVisible(gap, point, camera);
    expect(res.visible).toBe(false);
    expect(res.hitPart).toBe('belt-deck');
  });

  it('GAP: a point inside the 100 mm opening is visible', () => {
    const gap = defaultConfig();
    gap.station.bottomTransfer = 'GAP';
    const inGap = { x: 0, y: 0, z: 1100 }; // mid-station gap centre
    const cam = { x: 0, y: -850, z: 1100 };
    expect(isBottomPointVisible(gap, inGap, cam).visible).toBe(true);
  });
});
