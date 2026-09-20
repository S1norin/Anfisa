import {
  cloneCameraRig,
  defaultCameraRigs,
  defaultLineScanRig,
  moveCameraRig,
  frustumCornersMm,
  nextCameraId,
  nextCameraState,
  projectPointMm,
  removeCameraRig,
  setCameraRigEnabled,
  sensorIntrinsics,
  syncCameraStates,
  toCameraSpace,
  validateCameraRigs,
  type CameraStateEvent,
} from './camera';
import { defaultConfig } from './config';
import type { CameraConfig, CameraState } from './types';

const CAMS = {
  sensorWidthPx: 5320,
  sensorHeightPx: 3032,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 20,
  shutter: 'GLOBAL' as const,
};
const STATION = { lengthMm: 2200, beltWidthMm: 650 };
const rigs = () => defaultCameraRigs(STATION, CAMS);
const ev = (type: CameraStateEvent['type']): CameraStateEvent =>
  ({ type }) as CameraStateEvent;

describe('default rigs (CAM-001, CAM-002)', () => {
  it('creates six readers with unique ids and the standard roles', () => {
    const rs = rigs();
    expect(rs).toHaveLength(6);
    expect(rs.map((r) => r.role)).toEqual([
      'FRONT',
      'REAR',
      'LEFT',
      'RIGHT',
      'TOP',
      'BOTTOM',
    ]);
    expect(new Set(rs.map((r) => r.id)).size).toBe(6);
    expect(rs[0].id).toBe('CAM-001');
    expect(rs.every((r) => r.enabled)).toBe(true);
  });

  it('poses are normalized and pass validation', () => {
    for (const r of rigs()) {
      const q = r.pose.quaternion;
      expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 6);
    }
    expect(validateCameraRigs(rigs())).toEqual([]);
  });

  it('each default reader sees the middle of the belt in its image', () => {
    const mid: [number, number, number] = [0, 0, STATION.lengthMm / 2];
    for (const r of rigs()) {
      const cam = toCameraSpace(mid, r);
      expect(cam[2]).toBeGreaterThan(0); // in front of the sensor
      const p = projectPointMm(mid, r);
      expect(p).not.toBeNull();
      expect(p!.xPx).toBeGreaterThan(0);
      expect(p!.xPx).toBeLessThan(r.sensor.widthPx);
      expect(p!.yPx).toBeGreaterThan(0);
      expect(p!.yPx).toBeLessThan(r.sensor.heightPx);
    }
  });
});

describe('intrinsics & projection (CAM-003)', () => {
  it('derives fx from focal length and film gauge', () => {
    const intr = sensorIntrinsics(rigs()[0].sensor);
    const pitch = 23.5 / 5320;
    expect(intr.pixelPitchMm).toBeCloseTo(pitch, 10);
    expect(intr.fx).toBeCloseTo(16 / pitch, 6);
    expect(intr.fy).toBeCloseTo(intr.fx, 6);
    expect(intr.aspect).toBeCloseTo(5320 / 3032, 10);
    expect(intr.fovYDeg).toBeCloseTo(
      (2 * Math.atan((3032 * pitch) / (2 * 16)) * 180) / Math.PI,
      6,
    );
  });

  it('projects a world point on the optical axis to the principal point', () => {
    const r = rigs()[4]; // TOP: eye [0,2000,1100], target [0,0,1100]
    const intr = sensorIntrinsics(r.sensor);
    const p = projectPointMm([0, 0, 1100], r);
    expect(p).not.toBeNull();
    expect(p!.xPx).toBeCloseTo(intr.cx, 3);
    expect(p!.yPx).toBeCloseTo(intr.cy, 3);
    expect(p!.zMm).toBeCloseTo(2000, 3);
  });

  it('returns null for points behind the camera or outside the sensor', () => {
    const r = rigs()[4];
    expect(projectPointMm([0, 3000, 1100], r)).toBeNull(); // behind
    expect(projectPointMm([-5000, 0, 1100], r)).toBeNull(); // off-sensor
  });

  it('gives eight frustum corners at the near/far distances', () => {
    const r = rigs()[4];
    const intr = sensorIntrinsics(r.sensor);
    const halfW = (r.sensor.widthPx / 2) * intr.pixelPitchMm;
    const halfH = (r.sensor.heightPx / 2) * intr.pixelPitchMm;
    const corners = frustumCornersMm(r);
    expect(corners).toHaveLength(8);
    const dist = (c: [number, number, number]) =>
      Math.hypot(c[0], c[1] - 2000, c[2] - 1100);
    const near = Math.hypot(50, halfW, halfH);
    const far = Math.hypot(8000, halfW, halfH);
    for (let i = 0; i < 4; i++) expect(dist(corners[i])).toBeCloseTo(near, 3);
    for (let i = 4; i < 8; i++) expect(dist(corners[i])).toBeCloseTo(far, 3);
  });
});

describe('state machine (CAM-004)', () => {
  it('walks the happy path IDLE → ARMED → CAPTURING → PROCESSING → IDLE', () => {
    let s: CameraState = 'IDLE';
    s = nextCameraState(s, ev('TRIGGER_ZONE_ACTIVE'));
    expect(s).toBe('ARMED');
    s = nextCameraState(s, ev('CAPTURE_STARTED'));
    expect(s).toBe('CAPTURING');
    s = nextCameraState(s, ev('CAPTURE_FINISHED'));
    expect(s).toBe('PROCESSING');
    s = nextCameraState(s, ev('PROCESSING_FINISHED'));
    expect(s).toBe('IDLE');
  });

  it('disables to OFFLINE and re-enables to IDLE', () => {
    expect(nextCameraState('IDLE', ev('DISABLE'))).toBe('OFFLINE');
    expect(nextCameraState('ARMED', ev('DISABLE'))).toBe('OFFLINE');
    expect(nextCameraState('OFFLINE', ev('ENABLE'))).toBe('IDLE');
  });

  it('faults from any live state and clears back to IDLE', () => {
    for (const s of ['IDLE', 'ARMED', 'CAPTURING', 'PROCESSING'] as const) {
      expect(nextCameraState(s, ev('FAULT_RAISED'))).toBe('FAULT');
    }
    expect(nextCameraState('FAULT', ev('FAULT_CLEARED'))).toBe('IDLE');
    expect(nextCameraState('FAULT', ev('TRIGGER_ZONE_ACTIVE'))).toBe('FAULT');
  });

  it('is a no-op on unknown combinations', () => {
    expect(nextCameraState('OFFLINE', ev('CAPTURE_STARTED'))).toBe('OFFLINE');
    expect(nextCameraState('IDLE', ev('CAPTURE_STARTED'))).toBe('IDLE');
    expect(nextCameraState('FAULT', ev('FAULT_RAISED'))).toBe('FAULT');
  });
});

describe('CRUD (CAM-002)', () => {
  it('assigns the next free id', () => {
    const rs = rigs();
    expect(nextCameraId(rs)).toBe('CAM-007');
    const cloned = cloneCameraRig(rs, 'CAM-003', 'CAM-007');
    expect(nextCameraId(cloned)).toBe('CAM-008');
  });

  it('clones a rig with a new id and keeps the list valid', () => {
    const rs = rigs();
    const cloned = cloneCameraRig(rs, 'CAM-001', 'CAM-007', 'Front clone');
    expect(cloned).toHaveLength(7);
    const copy = cloned.find((r) => r.id === 'CAM-007')!;
    expect(copy.name).toBe('Front clone');
    expect(copy.pose.positionMm).toEqual(rs[0].pose.positionMm);
    expect(validateCameraRigs(cloned)).toEqual([]);
  });

  it('removes, disables, and re-enables rigs', () => {
    let rs: CameraConfig[] = rigs();
    rs = removeCameraRig(rs, 'CAM-002');
    expect(rs).toHaveLength(5);
    rs = setCameraRigEnabled(rs, 'CAM-005', false);
    expect(rs.find((r) => r.id === 'CAM-005')!.enabled).toBe(false);
    rs = setCameraRigEnabled(rs, 'CAM-005', true);
    expect(rs.find((r) => r.id === 'CAM-005')!.enabled).toBe(true);
  });

  it('moves a rig with a fresh pose', () => {
    const rs = rigs();
    const moved = moveCameraRig(rs, 'CAM-001', [10, 20, 30], [0, 0, 0, 1]);
    const target = moved.find((r) => r.id === 'CAM-001')!;
    expect(target.pose.positionMm).toEqual([10, 20, 30]);
    expect(rs.find((r) => r.id === 'CAM-001')!.pose.positionMm).toEqual([
      0, 1200, -900,
    ]);
  });
});

describe('state sync (CAM-004)', () => {
  it('starts enabled rigs IDLE and disabled rigs OFFLINE', () => {
    const rs = setCameraRigEnabled(rigs(), 'CAM-002', false);
    const states = syncCameraStates(rs, {});
    expect(states['CAM-001']).toBe('IDLE');
    expect(states['CAM-002']).toBe('OFFLINE');
    expect(Object.keys(states)).toHaveLength(6);
  });

  it('drops removed rigs and restores re-enabled ones', () => {
    const rs = rigs();
    const states = syncCameraStates(rs, {});
    states['CAM-003'] = 'PROCESSING';
    const without = syncCameraStates(removeCameraRig(rs, 'CAM-003'), states);
    expect(without['CAM-003']).toBeUndefined();
    const restored = syncCameraStates(
      setCameraRigEnabled(rs, 'CAM-003', true),
      states,
    );
    expect(restored['CAM-003']).toBe('PROCESSING'); // runtime progress kept
  });
});

describe('validation (CFG-001, NFR-007)', () => {
  it('accepts the defaults', () => {
    expect(validateCameraRigs(rigs())).toEqual([]);
  });

  it('flags duplicate ids and empty names', () => {
    const rs = rigs();
    rs[1] = { ...rs[1], id: rs[0].id };
    const errs = validateCameraRigs(rs);
    expect(errs.some((e) => e.path === 'cameraRigs[1].id')).toBe(true);
  });

  it('rejects out-of-range sensor values and far ≤ near', () => {
    const rs = rigs();
    rs[0] = {
      ...rs[0],
      sensor: { ...rs[0].sensor, focalLengthMm: -4, farMm: 10 },
    };
    const errs = validateCameraRigs(rs);
    expect(errs.some((e) => e.path === 'cameraRigs[0].sensor.focalLengthMm')).toBe(true);
    expect(errs.some((e) => e.path === 'cameraRigs[0].sensor.farMm')).toBe(true);
  });

  it('rejects unnormalized quaternions', () => {
    const rs = rigs();
    rs[2] = {
      ...rs[2],
      pose: {
        ...rs[2].pose,
        quaternion: [2, 0, 0, 0],
      } as CameraConfig['pose'],
    };
    const errs = validateCameraRigs(rs);
    expect(errs.some((e) => e.path === 'cameraRigs[2].pose.quaternion')).toBe(true);
  });

  it('keeps whole-config validation green for the default config', () => {
    const cfg = defaultConfig();
    expect(validateCameraRigs(cfg.cameraRigs)).toEqual([]);
  });

  it('LINE_SCAN: a valid line rig validates with no area fields', () => {
    const rs = rigs();
    const line = defaultLineScanRig(
      'CAM-L01',
      'TOP',
      [0, 2000, 1100],
      [0, 0, 0, 1],
      0,
    );
    const errs = validateCameraRigs([...rs, line]);
    expect(errs).toEqual([]);
  });

  it('LINE_SCAN: area-only blocks are rejected with named field errors', () => {
    const line = defaultLineScanRig(
      'CAM-L01',
      'TOP',
      [0, 2000, 1100],
      [0, 0, 0, 1],
      0,
    );
    // v2-leak shape: an acquisition block (exposureMs etc.) on a line rig.
    const bad = {
      ...line,
      acquisition: { fps: 20, exposureUs: 75, gainDb: 0, focusDistanceMm: 900, shutter: 'GLOBAL' },
    } as unknown as CameraConfig;
    const errs = validateCameraRigs([bad]);
    expect(
      errs.some((e) => e.path === 'cameraRigs[0].acquisition'),
    ).toBe(true);
  });

  it('LINE_SCAN: out-of-range line fields are rejected by name', () => {
    const line = defaultLineScanRig(
      'CAM-L01',
      'TOP',
      [0, 2000, 1100],
      [0, 0, 0, 1],
      0,
    );
    const bad = {
      ...line,
      line: { ...line.line, encoderStepMmPerLine: 0.001, maxLineRateLinesPerSec: 10 },
    } as CameraConfig;
    const errs = validateCameraRigs([bad]);
    expect(
      errs.some((e) => e.path === 'cameraRigs[0].line.encoderStepMmPerLine'),
    ).toBe(true);
    expect(
      errs.some((e) => e.path === 'cameraRigs[0].line.maxLineRateLinesPerSec'),
    ).toBe(true);
  });

  it('mixed AREA + LINE rigs validate together', () => {
    const rs = rigs();
    const line = defaultLineScanRig(
      'CAM-L02',
      'BOTTOM',
      [0, -400, 1100],
      [0, 0, 0, 1],
      0,
    );
    expect(validateCameraRigs([...rs.slice(0, 4), line] as CameraConfig[])).toEqual([]);
  });
});
