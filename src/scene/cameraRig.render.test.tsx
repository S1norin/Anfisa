/**
 * Rendered DOM assertions for the camera rig scene (t8). R3F elements
 * render as unknown DOM elements under jsdom, which is enough to assert
 * the rendered child geometry, state colors, and onClick selection.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { reportSixViewConfig } from '../capture/presets';
import type { CameraConfig, CameraState, LineScanCameraConfig } from '../domain/types';
import { CameraRigScene, rigStateColor } from './cameraRig';

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
    const w = rig.line.sensorWidthMm * 0.001;

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
