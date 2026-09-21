/**
 * Rendered DOM assertions for the camera rig scene (t8). R3F elements
 * render as unknown DOM elements under jsdom, which is enough to assert
 * the rendered child geometry, state colors, and onClick selection.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { reportEightReaderConfig, reportSixViewConfig } from '../capture/presets';
import type { CameraConfig, CameraState, LineScanCameraConfig } from '../domain/types';
import {
  CameraRigScene,
  rigStateColor,
  workingDistanceSegment,
} from './cameraRig';

function lineRig(role: 'TOP' | 'BOTTOM'): LineScanCameraConfig {
  const cfg = reportSixViewConfig();
  const rig = cfg.cameraRigs.find(
    (r): r is LineScanCameraConfig => r.role === role && r.kind === 'LINE_SCAN',
  );
  if (!rig) throw new Error(`report layout has no ${role} line scanner`);
  return rig;
}

function areaRig(): CameraConfig {
  const cfg = reportSixViewConfig();
  const rig = cfg.cameraRigs.find((r) => r.kind === 'AREA_SCAN');
  if (!rig) throw new Error('report layout has no area scanner');
  return rig;
}

interface RigDom {
  /** meshes inside the rig group (local space), in render order */
  rigMeshes: Element[];
  /** world-space meshes on the outer group (line scan plane) */
  worldMeshes: Element[];
}

function renderRig(
  rig: CameraConfig,
  state: CameraState,
  opts: { selected?: boolean; onSelect?: (id: string) => void } = {},
): RigDom & { container: HTMLElement } {
  const onSelect = opts.onSelect ?? (() => {});
  const { container } = render(
    <CameraRigScene
      rigs={[rig]}
      states={{ [rig.id]: state }}
      selectedId={opts.selected ? rig.id : null}
      onSelect={onSelect}
    />,
  );
  const outer = container.querySelector(':scope > group')!;
  const rigGroup = outer.querySelector(':scope > group')!;
  return {
    container,
    rigMeshes: [...rigGroup.querySelectorAll(':scope > mesh')],
    worldMeshes: [...outer.querySelectorAll(':scope > mesh')],
  };
}

function meshMaterial(mesh: Element): Element {
  return mesh.querySelector(':scope > meshstandardmaterial')!;
}

function boxArgs(mesh: Element): number[] {
  const geo = mesh.querySelector(':scope > boxgeometry')!;
  return geo.getAttribute('args')!.split(',').map(Number);
}

function position(mesh: Element): number[] {
  return (mesh.getAttribute('position') ?? '0,0,0').split(',').map(Number);
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('rendered line-scan rig (t8)', () => {
  it('renders housing + optical line marker + thin scan plane at scanPlaneZMm', () => {
    const rig = lineRig('TOP');
    const { rigMeshes, worldMeshes } = renderRig(rig, 'IDLE');

    expect(rigMeshes).toHaveLength(2); // housing + marker
    expect(worldMeshes).toHaveLength(1); // scan plane

    const housing = boxArgs(rigMeshes[0]);
    const marker = boxArgs(rigMeshes[1]);
    const plane = boxArgs(worldMeshes[0]);
    const w = rig.line.fovWidthMm * 0.001;

    // Long narrow housing, sensor axis along Y.
    expect(housing[1]).toBeCloseTo(w + 0.04, 6);
    expect(housing[1]).toBeGreaterThan(housing[0] * 3);
    expect(housing[1]).toBeGreaterThan(housing[2] * 3);
    // Thin marker on the front face, spanning the sensor.
    expect(marker[1]).toBeCloseTo(w, 6);
    expect(marker[0]).toBeLessThan(housing[0] / 2);
    expect(position(rigMeshes[1])[2]).toBeLessThan(0);
    // Thin world-space slab exactly at scanPlaneZMm (mm → m).
    expect(plane[0]).toBeCloseTo(w, 6);
    expect(position(worldMeshes[0])[2]).toBeCloseTo(rig.line.scanPlaneZMm * 0.001, 9);
  });

  it('mesh count is constant regardless of sensor/encoder settings (no per-line meshes)', () => {
    const rig = lineRig('TOP');
    const base = renderRig(rig, 'IDLE');
    const baseCount = base.rigMeshes.length + base.worldMeshes.length;
    expect(baseCount).toBe(3);

    const scaled: LineScanCameraConfig = {
      ...rig,
      line: {
        ...rig.line,
        pixelsPerLine: rig.line.pixelsPerLine * 16,
        encoderStepMmPerLine: rig.line.encoderStepMmPerLine / 16,
        maxLineRateLinesPerSec: rig.line.maxLineRateLinesPerSec * 16,
      },
    };
    const after = renderRig(scaled, 'IDLE');
    expect(after.rigMeshes.length + after.worldMeshes.length).toBe(baseCount);
  });

  it('is selectable via onClick on the housing and the scan plane', () => {
    const rig = lineRig('BOTTOM');
    const onSelect = vi.fn();
    const { rigMeshes, worldMeshes } = renderRig(rig, 'IDLE', { onSelect });

    click(rigMeshes[0]);
    expect(onSelect).toHaveBeenCalledWith(rig.id);
    click(worldMeshes[0]);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(rig.id);
  });

  it('shows the selection emissive on the housing when selected', () => {
    const rig = lineRig('TOP');
    const unselected = meshMaterial(renderRig(rig, 'IDLE').rigMeshes[0]);
    expect(unselected.getAttribute('emissive')).toBe('#000000');
    expect(unselected.getAttribute('emissiveintensity')).toBe('0');

    const selected = meshMaterial(renderRig(rig, 'IDLE', { selected: true }).rigMeshes[0]);
    expect(selected.getAttribute('emissive')).toBe('#ffb84f');
    expect(selected.getAttribute('emissiveintensity')).toBe('0.45');
  });

  it('reflects the state color on marker and scan plane exactly like area rigs', () => {
    const rig = lineRig('TOP');
    for (const state of ['FAULT', 'IDLE', 'OFFLINE', 'CAPTURING'] as CameraState[]) {
      const { rigMeshes, worldMeshes } = renderRig(rig, state);
      expect(meshMaterial(rigMeshes[1]).getAttribute('color')).toBe(rigStateColor(state));
      expect(meshMaterial(worldMeshes[0]).getAttribute('color')).toBe(rigStateColor(state));
    }
  });

  it('dims the scan plane when the rig is disabled (same convention as the area frustum)', () => {
    const enabled = meshMaterial(renderRig(lineRig('TOP'), 'IDLE').worldMeshes[0]);
    expect(enabled.getAttribute('opacity')).toBe('0.75');
    const disabled = meshMaterial(
      renderRig({ ...lineRig('TOP'), enabled: false }, 'OFFLINE').worldMeshes[0],
    );
    expect(disabled.getAttribute('opacity')).toBe('0.25');
  });
});

describe('rendered area rig is unchanged (t8)', () => {
  it('renders body + lens (2 meshes) plus the frustum, and stays selectable', () => {
    const rig = areaRig();
    const onSelect = vi.fn();
    const { rigMeshes, worldMeshes, container } = renderRig(rig, 'IDLE', { onSelect });

    expect(rigMeshes).toHaveLength(2);
    expect(worldMeshes).toHaveLength(0);
    // The frustum helper renders as a primitive (line segments).
    expect(container.querySelector('primitive')).not.toBeNull();
    // No world-space scan plane for area rigs (worldMeshes above).

    click(rigMeshes[0]);
    expect(onSelect).toHaveBeenCalledWith(rig.id);
  });
});

describe('rendered report-8reader rigs (t3-rig)', () => {
  const cfg = reportEightReaderConfig();
  const rigs = cfg.cameraRigs;
  const states = Object.fromEntries(rigs.map((r) => [r.id, 'IDLE' as CameraState]));

  function renderAll(showWorkingDistances: boolean) {
    const { container } = render(
      <CameraRigScene
        rigs={rigs}
        states={states}
        selectedId={null}
        onSelect={() => {}}
        showWorkingDistances={showWorkingDistances}
      />,
    );
    const outers = [...container.querySelectorAll(':scope > group')];
    return {
      container,
      outers,
      localMeshes: (outer: Element) =>
        [...outer.querySelector(':scope > group')!.querySelectorAll(':scope > mesh')],
      worldBoxes: (outer: Element) =>
        [...outer.querySelectorAll(':scope > mesh')].filter((m) =>
          m.querySelector(':scope > boxgeometry'),
        ),
      worldCylinders: (outer: Element) =>
        [...outer.querySelectorAll(':scope > mesh')].filter((m) =>
          m.querySelector(':scope > cylindergeometry'),
        ),
    };
  }

  it('mounts all eight rigs from reportEightReaderConfig (6 area + 2 line)', () => {
    expect(rigs).toHaveLength(8);
    const { outers, localMeshes, worldBoxes } = renderAll(false);
    // One outer group per rig, in config order.
    expect(outers).toHaveLength(8);

    for (const [rig, outer] of rigs.map((r, i) => [r, outers[i]] as const)) {
      // Housing + lens (area) / housing + line marker (line): 2 local meshes.
      expect(localMeshes(outer)).toHaveLength(2);
      // Area rigs render their frustum as a primitive; line rigs the world
      // scan plane as a box (never both).
      if (rig.kind === 'AREA_SCAN') {
        expect(outer.querySelector('primitive')).not.toBeNull();
        expect(worldBoxes(outer)).toHaveLength(0);
      } else {
        expect(worldBoxes(outer)).toHaveLength(1);
      }
    }
  });

  it('line scan planes span the 715 mm FOV width at deck level, Z = scanPlaneZMm', () => {
    const { outers, worldBoxes } = renderAll(false);
    for (const [rig, outer] of rigs.map((r, i) => [r, outers[i]] as const)) {
      if (rig.kind !== 'LINE_SCAN') continue;
      const plane = worldBoxes(outer)[0];
      const args = plane
        .querySelector(':scope > boxgeometry')!
        .getAttribute('args')!
        .split(',')
        .map(Number);
      expect(args[0]).toBeCloseTo(rig.line.fovWidthMm * 0.001, 9); // 715 mm
      const pos = (plane.getAttribute('position') ?? '0,0,0')
        .split(',')
        .map(Number);
      expect(pos[1]).toBeCloseTo(0, 9); // deck level
      expect(pos[2]).toBeCloseTo(rig.line.scanPlaneZMm * 0.001, 9);
    }
  });

  it('working-distance rods: 1450 mm side readers, 100 mm bottom gap, off by default', () => {
    // Off by default: no indicator rods.
    const off = renderAll(false);
    for (const outer of off.outers) expect(off.worldCylinders(outer)).toHaveLength(0);

    const { outers, worldCylinders } = renderAll(true);
    for (const [rig, outer] of rigs.map((r, i) => [r, outers[i]] as const)) {
      const rods = worldCylinders(outer);
      expect(rods).toHaveLength(1);
      const h = rods[0]
        .querySelector(':scope > cylindergeometry')!
        .getAttribute('args')!
        .split(',')
        .map(Number)[2];
      const seg = workingDistanceSegment(rig);
      const segLen = Math.hypot(
        seg.to[0] - seg.from[0],
        seg.to[1] - seg.from[1],
        seg.to[2] - seg.from[2],
      );
      expect(h).toBeCloseTo(segLen, 9);
      if (rig.kind === 'AREA_SCAN') {
        // The 8-reader side working distance (focus distance), not a layout constant.
        expect(h).toBeCloseTo(1.45, 9);
      }
    }
    // Bottom line reader: lens (−100 mm) → deck: exactly the 100 mm gap.
    const bottom = rigs.find((r) => r.role === 'BOTTOM')!;
    const bottomOuter = outers[rigs.indexOf(bottom)];
    const bottomH = worldCylinders(bottomOuter)[0]
      .querySelector(':scope > cylindergeometry')!
      .getAttribute('args')!
      .split(',')
      .map(Number)[2];
    expect(bottomH).toBeCloseTo(0.1, 9);
  });
});
