/**
 * The two curated replay fixtures (HOW_IT_WORKS_VISUAL_REDESIGN_PLAN.md:
 * "show one selected parcel as a repeatable story. Default to a curated
 * sample with visible top and side labels. Offer a second sample with glare
 * or a missed read to explain failure.").
 *
 * Builders are pure and deterministic by construction: fixed data only, no
 * clocks, no randomness (NFR-001). The asset generator
 * (scripts/gen_hiw_assets.py) consumes the same definitions to render the
 * stage images referenced by the paths below.
 */

import {
  REPLAY_SCHEMA_VERSION,
  type ReplayManifest,
  type StageName,
} from './replayManifest';

const DURATION_MS = 60_000;
const STEP_MS = 7_500;

/** Display order of the processing stages (raw first, decode crop last). */
const STAGE_ORDER: StageName[] = [
  'raw',
  'maskedCrop',
  'grayscaleContrast',
  'edgeMap',
  'candidateOverlay',
  'rectifiedCrop',
];

/**
 * Six side 2D cameras of section 2. Azimuth (deg, 0 = facing the FRONT face):
 * the two front-quarter cameras can read the FRONT-face label; the rest see
 * it edge-on or not at all.
 */
const SIDE_CAMERAS = [
  { id: 'cam-side-1', face: 'FRONT' as const, azimuthDeg: 0 },
  { id: 'cam-side-2', face: 'RIGHT' as const, azimuthDeg: 45 },
  { id: 'cam-side-3', face: 'RIGHT' as const, azimuthDeg: 135 },
  { id: 'cam-side-4', face: 'REAR' as const, azimuthDeg: 180 },
  { id: 'cam-side-5', face: 'LEFT' as const, azimuthDeg: 225 },
  { id: 'cam-side-6', face: 'LEFT' as const, azimuthDeg: 270 },
];

function assetPath(fixtureId: string, captureId: string, stage: string): string {
  return `hiw/assets/${fixtureId}/${captureId}/${stage}.png`;
}

/**
 * The four side cameras that cannot see the FRONT-face label (edge-on or
 * hidden face): no candidate, no decode crop, no expected decode. They still
 * capture the parcel — their frames show the box WITHOUT a label, which is
 * what teaches "same label, different viewing angle" (step 5).
 */
const OUT_OF_VIEW_SIDE_CAPTURES = [
  { captureId: 'cap-cam-3-01', sensorId: 'cam-side-3', kind: 'AREA_CAMERA' as const, simTimeMs: 36_000, encoderSpanMm: [790, 790] as [number, number] },
  { captureId: 'cap-cam-4-01', sensorId: 'cam-side-4', kind: 'AREA_CAMERA' as const, simTimeMs: 36_100, encoderSpanMm: [795, 795] as [number, number] },
  { captureId: 'cap-cam-5-01', sensorId: 'cam-side-5', kind: 'AREA_CAMERA' as const, simTimeMs: 36_200, encoderSpanMm: [800, 800] as [number, number] },
  { captureId: 'cap-cam-6-01', sensorId: 'cam-side-6', kind: 'AREA_CAMERA' as const, simTimeMs: 36_300, encoderSpanMm: [805, 805] as [number, number] },
];

/**
 * Story pose: entry (−150 mm) → line-scan planes (~250 mm) → hold at the end
 * of section 1 (450 mm) → section 2 side cameras (650..950 mm) → exit
 * (1400 mm). One keyframe per step boundary, 8 steps × 7.5 s.
 */
function buildKeyframes(): ReplayManifest['keyframes'] {
  const frontZ = [-150, -40, 320, 450, 450, 800, 950, 1200, 1400];
  return frontZ.map((z, i) => ({ tMs: i * STEP_MS, frontZMm: z, encoderMm: z }));
}

function buildSteps(capture: { line: string; side: string }): ReplayManifest['steps'] {
  const s = (step: number, sensorIds: string[], captureId?: string) => ({
    step,
    tStartMs: (step - 1) * STEP_MS,
    tEndMs: step * STEP_MS,
    sensorIds,
    ...(captureId ? { captureId } : {}),
  });
  return [
    s(1, ['photoeye-entry']),
    s(2, ['ls-top', 'ls-bottom'], capture.line),
    s(3, ['ls-top', 'ls-bottom'], capture.line),
    s(4, ['ls-top'], capture.line),
    s(5, SIDE_CAMERAS.map((c) => c.id), capture.side),
    s(6, ['cam-side-1'], capture.side),
    s(7, ['ls-top', ...SIDE_CAMERAS.map((c) => c.id)]),
    s(8, []),
  ];
}

/**
 * Success fixture: a clean parcel. Top label read by the top line scan;
 * side label read by TWO side cameras (duplicate reads that must merge);
 * the other four side cameras see the label edge-on / on a hidden face
 * (out-of-view → no candidate, teaches "no candidate" vs "failed
decode").
 */
export function buildSuccessManifest(): ReplayManifest {
  const parcelId = 'PARCEL-2026-0001';
  const topPayload = 'A1F4-2026-0001';
  const sidePayload = 'B7K9-2026-0042';
  const captures: ReplayManifest['captures'] = [
    {
      captureId: 'cap-ls-top-01',
      sensorId: 'ls-top',
      kind: 'LINE_SCAN',
      parcelId,
      simTimeMs: 12_000,
      encoderSpanMm: [200, 320],
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('success', 'cap-ls-top-01', stage) })),
      candidate: {
        labelInstanceId: 'L-top',
        source: 'pixels',
        quadPx: [
          [50, 215],
          [521, 215],
          [521, 276],
          [50, 276],
        ],
      },
      decodeCropPath: assetPath('success', 'cap-ls-top-01', 'decode-crop'),
      expectedDecode: { decoded: true, payload: topPayload, reasons: [] },
    },
    {
      captureId: 'cap-cam-1-01',
      sensorId: 'cam-side-1',
      kind: 'AREA_CAMERA',
      parcelId,
      simTimeMs: 35_000,
      encoderSpanMm: [780, 780],
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('success', 'cap-cam-1-01', stage) })),
      candidate: {
        labelInstanceId: 'L-side',
        source: 'pixels',
        quadPx: [
          [213, 106],
          [358, 106],
          [358, 195],
          [213, 195],
        ],
      },
      decodeCropPath: assetPath('success', 'cap-cam-1-01', 'decode-crop'),
      expectedDecode: { decoded: true, payload: sidePayload, reasons: [] },
    },
    {
      captureId: 'cap-cam-2-01',
      sensorId: 'cam-side-2',
      kind: 'AREA_CAMERA',
      parcelId,
      simTimeMs: 35_500,
      encoderSpanMm: [785, 785],
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('success', 'cap-cam-2-01', stage) })),
      candidate: {
        labelInstanceId: 'L-side',
        source: 'pixels',
        quadPx: [
          [184, 105],
          [271, 105],
          [271, 198],
          [184, 198],
        ],
      },
      decodeCropPath: assetPath('success', 'cap-cam-2-01', 'decode-crop'),
      expectedDecode: { decoded: true, payload: sidePayload, reasons: [] },
    },
    ...OUT_OF_VIEW_SIDE_CAPTURES.map((c) => ({
      ...c,
      parcelId,
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('success', c.captureId, stage) })),
    })),
  ];

  const observations: ReplayManifest['observations'] = [
    {
      observationId: 'obs-1',
      captureId: 'cap-ls-top-01',
      parcelId,
      labelInstanceId: 'L-top',
      decoded: true,
      decodedPayload: topPayload,
      reasons: [],
      association: { ok: true },
    },
    {
      observationId: 'obs-2',
      captureId: 'cap-cam-1-01',
      parcelId,
      labelInstanceId: 'L-side',
      decoded: true,
      decodedPayload: sidePayload,
      reasons: [],
      association: { ok: true },
    },
    {
      observationId: 'obs-3',
      captureId: 'cap-cam-2-01',
      parcelId,
      labelInstanceId: 'L-side',
      decoded: true,
      decodedPayload: sidePayload,
      reasons: [],
      association: { ok: true },
    },
  ];

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    fixtureId: 'success',
    parcel: {
      parcelId,
      label: 'Sample parcel (clean reads)',
      labels: [
        { labelInstanceId: 'L-top', face: 'TOP', payload: topPayload },
        { labelInstanceId: 'L-side', face: 'FRONT', payload: sidePayload },
      ],
    },
    durationMs: DURATION_MS,
    keyframes: buildKeyframes(),
    sensors: [
      { id: 'photoeye-entry', kind: 'AREA_CAMERA', face: 'TOP' },
      { id: 'ls-top', kind: 'LINE_SCAN', face: 'TOP' },
      { id: 'ls-bottom', kind: 'LINE_SCAN', face: 'BOTTOM' },
      ...SIDE_CAMERAS.map((c) => ({ id: c.id, kind: 'AREA_CAMERA' as const, face: c.face })),
    ],
    captures,
    observations,
    steps: buildSteps({ line: 'cap-ls-top-01', side: 'cap-cam-1-01' }),
    result: {
      parcelId,
      status: 'OK',
      finalSimTimeMs: 58_000,
      values: [
        {
          labelInstanceId: 'L-top',
          face: 'TOP',
          payload: topPayload,
          sourceCaptureIds: ['cap-ls-top-01'],
          mergedReads: 1,
        },
        {
          labelInstanceId: 'L-side',
          face: 'FRONT',
          payload: sidePayload,
          sourceCaptureIds: ['cap-cam-1-01', 'cap-cam-2-01'],
          mergedReads: 2,
        },
      ],
      failedReads: [],
    },
  };
}

/**
 * No-read fixture: the top line scan still reads, but BOTH label-facing
 * side cameras fail — glare on cam-side-1, low-contrast wrap on cam-side-2
 * (whose candidate is geometry-derived, so the UI must label it
 * "illustrative"). The other four side cameras see no label at all.
 * The side label is NEVER attributed a value.
 */
export function buildNoReadManifest(): ReplayManifest {
  const parcelId = 'PARCEL-2026-0002';
  const topPayload = 'C5M2-2026-0077';
  const sidePayload = 'C5M2-2026-0077';
  const captures: ReplayManifest['captures'] = [
    {
      captureId: 'cap-ls-top-01',
      sensorId: 'ls-top',
      kind: 'LINE_SCAN',
      parcelId,
      simTimeMs: 12_000,
      encoderSpanMm: [200, 320],
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('no-read', 'cap-ls-top-01', stage) })),
      candidate: {
        labelInstanceId: 'L-top',
        source: 'pixels',
        quadPx: [
          [50, 215],
          [521, 215],
          [521, 276],
          [50, 276],
        ],
      },
      decodeCropPath: assetPath('no-read', 'cap-ls-top-01', 'decode-crop'),
      expectedDecode: { decoded: true, payload: topPayload, reasons: [] },
    },
    {
      captureId: 'cap-cam-1-01',
      sensorId: 'cam-side-1',
      kind: 'AREA_CAMERA',
      parcelId,
      simTimeMs: 35_000,
      encoderSpanMm: [780, 780],
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('no-read', 'cap-cam-1-01', stage) })),
      candidate: {
        labelInstanceId: 'L-side',
        source: 'pixels',
        quadPx: [
          [213, 106],
          [358, 106],
          [358, 195],
          [213, 195],
        ],
      },
      decodeCropPath: assetPath('no-read', 'cap-cam-1-01', 'decode-crop'),
      expectedDecode: { decoded: false, reasons: ['QUALITY:GLARE'] },
    },
    {
      captureId: 'cap-cam-2-01',
      sensorId: 'cam-side-2',
      kind: 'AREA_CAMERA',
      parcelId,
      simTimeMs: 35_500,
      encoderSpanMm: [785, 785],
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('no-read', 'cap-cam-2-01', stage) })),
      candidate: {
        labelInstanceId: 'L-side',
        // The label is under a low-contrast shrink wrap: no pixel candidate
        // survives detection, so this one is geometry-derived and the UI must
        // label it "illustrative candidate location".
        source: 'geometry',
        quadPx: [
          [184, 105],
          [271, 105],
          [271, 198],
          [184, 198],
        ],
      },
      decodeCropPath: assetPath('no-read', 'cap-cam-2-01', 'decode-crop'),
      expectedDecode: { decoded: false, reasons: ['QUALITY:LOW_CONTRAST'] },
    },
    ...OUT_OF_VIEW_SIDE_CAPTURES.map((c) => ({
      ...c,
      parcelId,
      stages: STAGE_ORDER.map((stage) => ({ stage, path: assetPath('no-read', c.captureId, stage) })),
    })),
  ];

  const observations: ReplayManifest['observations'] = [
    {
      observationId: 'obs-1',
      captureId: 'cap-ls-top-01',
      parcelId,
      labelInstanceId: 'L-top',
      decoded: true,
      decodedPayload: topPayload,
      reasons: [],
      association: { ok: true },
    },
    {
      observationId: 'obs-2',
      captureId: 'cap-cam-1-01',
      parcelId,
      labelInstanceId: 'L-side',
      decoded: false,
      reasons: ['QUALITY:GLARE'],
      association: { ok: true },
    },
    {
      observationId: 'obs-3',
      captureId: 'cap-cam-2-01',
      parcelId,
      labelInstanceId: 'L-side',
      decoded: false,
      reasons: ['QUALITY:LOW_CONTRAST'],
      association: { ok: true },
    },
  ];

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    fixtureId: 'no-read',
    parcel: {
      parcelId,
      label: 'Sample parcel (glare + missed side read)',
      labels: [
        { labelInstanceId: 'L-top', face: 'TOP', payload: topPayload },
        { labelInstanceId: 'L-side', face: 'FRONT', payload: sidePayload },
      ],
    },
    durationMs: DURATION_MS,
    keyframes: buildKeyframes(),
    sensors: [
      { id: 'photoeye-entry', kind: 'AREA_CAMERA', face: 'TOP' },
      { id: 'ls-top', kind: 'LINE_SCAN', face: 'TOP' },
      { id: 'ls-bottom', kind: 'LINE_SCAN', face: 'BOTTOM' },
      ...SIDE_CAMERAS.map((c) => ({ id: c.id, kind: 'AREA_CAMERA' as const, face: c.face })),
    ],
    captures,
    observations,
    steps: buildSteps({ line: 'cap-ls-top-01', side: 'cap-cam-1-01' }),
    result: {
      parcelId,
      status: 'PARTIAL',
      finalSimTimeMs: 58_000,
      values: [
        {
          labelInstanceId: 'L-top',
          face: 'TOP',
          payload: topPayload,
          sourceCaptureIds: ['cap-ls-top-01'],
          mergedReads: 1,
        },
      ],
      failedReads: [
        { captureId: 'cap-cam-1-01', labelInstanceId: 'L-side', reasons: ['QUALITY:GLARE'] },
        { captureId: 'cap-cam-2-01', labelInstanceId: 'L-side', reasons: ['QUALITY:LOW_CONTRAST'] },
      ],
    },
  };
}

/** All fixtures, keyed by fixtureId (used by the UI sample switcher). */
export const REPLAY_FIXTURES = {
  success: buildSuccessManifest,
  'no-read': buildNoReadManifest,
} as const;

export type FixtureId = keyof typeof REPLAY_FIXTURES;
