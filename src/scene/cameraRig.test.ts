import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { reportSixViewConfig } from '../capture/presets';
import { defaultConfig } from '../domain/config';
import { quatRotate } from '../domain/camera';
import type {
  AreaScanCameraConfig,
  LineScanCameraConfig,
} from '../domain/types';
import {
  AREA_RIG_LAYOUT,
  cameraRigToPerspective,
  lineRigLayout,
  rigStateColor,
  selectionEmissive,
} from './cameraRig';

describe('cameraRigToPerspective', () => {
  it('points the THREE camera down the rig +Z optical axis', () => {
    const rig = defaultConfig().cameraRigs[0] as AreaScanCameraConfig;
    const camera = cameraRigToPerspective(rig);
    const renderedForward = camera.getWorldDirection(new THREE.Vector3());
    const domainForward = quatRotate(rig.pose.quaternion, [0, 0, 1]);

    expect(renderedForward.x).toBeCloseTo(domainForward[0], 6);
    expect(renderedForward.y).toBeCloseTo(domainForward[1], 6);
    expect(renderedForward.z).toBeCloseTo(domainForward[2], 6);
  });
});

describe('line-scan rig layout (t8)', () => {
  function lineRig(role: 'TOP' | 'BOTTOM'): LineScanCameraConfig {
    const cfg = reportSixViewConfig();
    const rig = cfg.cameraRigs.find(
      (r): r is LineScanCameraConfig => r.role === role && r.kind === 'LINE_SCAN',
    );
    if (!rig) throw new Error(`report layout has no ${role} line scanner`);
    return rig;
  }

  it('housing is long and narrow along the sensor axis (local Y)', () => {
    const rig = lineRig('TOP');
    const l = lineRigLayout(rig);
    // Long axis = sensor width + margin; the other two axes stay small.
    expect(l.housingM[1]).toBeCloseTo(rig.line.sensorWidthMm * 0.001 + 0.04, 9);
    expect(l.housingM[1]).toBeGreaterThan(l.housingM[0] * 3);
    expect(l.housingM[1]).toBeGreaterThan(l.housingM[2] * 3);
  });

  it('optical line marker spans the sensor on the front (-Z) face', () => {
    const rig = lineRig('TOP');
    const l = lineRigLayout(rig);
    expect(l.lineMarkerM[1]).toBeCloseTo(rig.line.sensorWidthMm * 0.001, 9);
    expect(l.lineMarkerM[0]).toBeLessThan(l.housingM[0] / 2); // thin strip
    expect(l.lineMarkerPosM[2]).toBeLessThan(0); // optical front face
    expect(l.lineMarkerPosM[0]).toBe(0);
    expect(l.lineMarkerPosM[1]).toBe(0);
  });

  it('scan plane sits exactly at scanPlaneZMm (mm → m at the boundary)', () => {
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const rig = lineRig(role);
      const l = lineRigLayout(rig);
      expect(l.scanPlanePosM[2]).toBeCloseTo(rig.line.scanPlaneZMm * 0.001, 9);
      expect(l.scanPlanePosM[0]).toBeCloseTo(rig.pose.positionMm[0] * 0.001, 9);
      expect(l.scanPlanePosM[1]).toBeCloseTo(rig.pose.positionMm[1] * 0.001, 9);
      // The plane spans the sensor width, thin in the travel direction.
      expect(l.scanPlaneSizeM[0]).toBeCloseTo(rig.line.sensorWidthMm * 0.001, 9);
      expect(l.scanPlaneSizeM[2]).toBeLessThan(l.scanPlaneSizeM[0]);
    }
  });

  it('follows a moved scan plane', () => {
    const rig = lineRig('BOTTOM');
    const moved: LineScanCameraConfig = {
      ...rig,
      line: { ...rig.line, scanPlaneZMm: 300 },
    };
    expect(lineRigLayout(moved).scanPlanePosM[2]).toBeCloseTo(0.3, 9);
    // The housing stays with the rig pose, not the plane.
    expect(lineRigLayout(moved).housingM).toEqual(lineRigLayout(rig).housingM);
  });

  it('mesh count is constant: housing + marker + plane, never per-line', () => {
    const rig = lineRig('TOP');
    const base = lineRigLayout(rig);
    expect(base.meshCount).toBe(3);
    for (const factor of [2, 4, 16]) {
      const scaled: LineScanCameraConfig = {
        ...rig,
        line: {
          ...rig.line,
          pixelsPerLine: rig.line.pixelsPerLine * factor,
          encoderStepMmPerLine: rig.line.encoderStepMmPerLine / factor,
          maxLineRateLinesPerSec: rig.line.maxLineRateLinesPerSec * factor,
        },
      };
      expect(lineRigLayout(scaled), `factor ${factor}`).toEqual(base);
    }
  });

  it('sensor axis (local Y) aligns with the belt width (world X) in the report layout', () => {
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const rig = lineRig(role);
      const localY = quatRotate(rig.pose.quaternion, [0, 1, 0]);
      expect(Math.abs(localY[0])).toBeCloseTo(1, 6);
      expect(Math.abs(localY[1])).toBeLessThan(1e-9);
      expect(Math.abs(localY[2])).toBeLessThan(1e-9);
    }
  });
});

describe('shared selection + state-color behavior (t8)', () => {
  it('state colors map identically for area and line rigs', () => {
    expect(rigStateColor('FAULT')).toBe('#ff5c5c');
    expect(rigStateColor('OFFLINE')).toBe('#5b6472');
    expect(rigStateColor('IDLE')).toBe('#4f8cff');
    expect(rigStateColor('CAPTURING')).toBe('#ffb84f');
    expect(rigStateColor('PROCESSING')).toBe('#4fd0a0');
    expect(rigStateColor('ARMED')).toBe('#ffd166');
  });

  it('selection highlight is the shared emissive convention', () => {
    expect(selectionEmissive(true)).toEqual({ color: '#ffb84f', intensity: 0.45 });
    expect(selectionEmissive(false)).toEqual({ color: '#000000', intensity: 0 });
  });
});

describe('area rig layout is unchanged (t8)', () => {
  it('keeps the legacy body + lens shape (CAM-001)', () => {
    expect(AREA_RIG_LAYOUT.bodyM).toEqual([0.09, 0.11, 0.06]);
    expect(AREA_RIG_LAYOUT.lensM).toEqual([0.02, 0.025, 0.02, 24]);
    expect(AREA_RIG_LAYOUT.lensPosM).toEqual([0, 0, -0.038]);
    expect(AREA_RIG_LAYOUT.meshCount).toBe(2);
  });
});
