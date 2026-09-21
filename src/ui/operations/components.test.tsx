/**
 * Operations panel components (t11): timeline, result card, and live
 * metrics render their data with stable test IDs.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ParcelResult, ParcelState } from '../../domain/types';
import type { RunMetrics } from '../../metrics/metrics';
import { ParcelTimeline } from '../parcelTimeline';
import { ParcelResultCard } from '../parcelResult';
import { LiveMetrics } from '../liveMetrics';
import { parcelTimelineStages } from './timeline';

function testParcel(): ParcelState {
  return {
    parcelId: 'P-001',
    spec: {
      widthMm: 400,
      heightMm: 300,
      lengthMm: 500,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [
        {
          labelInstanceId: 'L-0001',
          payload: 'KTY-123',
          face: 'TOP',
          localOffsetMm: [0, 0],
          rotationDeg: 0,
          widthMm: 78,
          heightMm: 25,
          damage: 0,
        },
      ],
    },
    spawnSimTimeMs: 100,
    spawnEncoderMm: 0,
    frontZMm: 1100,
    phase: 'EXITED',
    entrySimTimeMs: 200,
    exitSimTimeMs: 3700,
  };
}

function testResult(): ParcelResult {
  return {
    parcelId: 'P-001',
    status: 'PARTIAL',
    expectedLabels: 2,
    decodedLabels: 1,
    uniquePayloads: 1,
    payloads: ['KTY-123'],
    labelResults: [
      {
        labelInstanceId: 'L-0001',
        face: 'TOP',
        payload: 'KTY-123',
        decodedPayload: 'KTY-123',
        decoded: true,
        bestConfidence: 0.9,
        observationCount: 5,
        decodedCount: 5,
        cameras: ['CAM-TOP'],
        reasons: [],
      },
      {
        labelInstanceId: 'L-0002',
        face: 'BOTTOM',
        payload: 'KTY-999',
        decoded: false,
        bestConfidence: 0,
        observationCount: 0,
        decodedCount: 0,
        cameras: [],
        reasons: ['NO_OBSERVATION'],
      },
    ],
    entrySimTimeMs: 200,
    exitSimTimeMs: 3700,
    finalizedSimTimeMs: 3950,
    ackSimTimeMs: 4000,
    entryToResultMs: 3750,
    exitToResultMs: 250,
  };
}

function zeroMetrics(): RunMetrics {
  return {
    evaluatedParcels: 2,
    completeReadRate: 0.5,
    barcodeRecall: 0.75,
    barcodePrecision: 1,
    expectedInstances: 4,
    decodedInstances: 3,
    correctDecodes: 3,
    falseDecodes: 0,
    misassociations: 1,
    totalObservations: 120,
    uniqueObservedInstances: 40,
    observationsCollapsed: 80,
    duplicateRate: 80 / 120,
    latency: {
      captureToDecodeMs: { n: 3, p50: 0, p95: 0, p99: 0 },
      entryToResultMs: { n: 2, p50: 3700, p95: 3800, p99: 3800 },
      exitToResultMs: { n: 2, p50: 250, p95: 260, p99: 260 },
      exitToAckMs: { n: 2, p50: 300, p95: 320, p99: 320 },
    },
    breakdowns: {
      camera: [],
      face: [],
      material: [],
      rotation: [],
      ppm: [],
      angle: [],
      reason: [],
    },
  };
}

describe('ParcelTimeline', () => {
  it('renders all seven stages with reached times', () => {
    const stages = parcelTimelineStages({
      parcelId: 'P-001',
      parcel: testParcel(),
      retired: undefined,
      result: testResult(),
      aggregate: undefined,
      observations: [],
      simEvents: [
        { type: 'PARCEL_SPAWNED', parcelId: 'P-001', simTimeMs: 100, encoderMm: 0 },
        {
          type: 'CAMERA_CAPTURED',
          cameraId: 'CAM-TOP',
          simTimeMs: 900,
          candidateParcelIds: ['P-001'],
        },
        { type: 'PARCEL_ENTERED', parcelId: 'P-001', simTimeMs: 200, encoderMm: 0 },
      ],
      pipelineEvents: [
        { type: 'PARCEL_FINALIZED', parcelId: 'P-001', simTimeMs: 3950, status: 'PARTIAL' },
        { type: 'PARCEL_ACKED', parcelId: 'P-001', simTimeMs: 4000 },
      ],
    });
    render(<ParcelTimeline parcelId="P-001" stages={stages} />);
    expect(screen.getByTestId('timeline-stage-SPAWNED')).toHaveTextContent('0.10 s');
    expect(screen.getByTestId('timeline-stage-ACK')).toHaveTextContent('4.00 s');
    for (const id of [
      'SPAWNED',
      'ENTERED',
      'CAPTURED',
      'DECODED',
      'AGGREGATED',
      'FINALIZED',
      'ACK',
    ]) {
      expect(screen.getByTestId(`timeline-stage-${id}`)).toBeInTheDocument();
    }
  });

  it('shows the empty state without a parcel', () => {
    render(<ParcelTimeline parcelId={null} stages={[]} />);
    expect(screen.getByTestId('parcel-timeline')).toHaveTextContent(
      'No parcel on the belt.',
    );
  });
});

describe('ParcelResultCard', () => {
  it('renders the finalized result with status, payloads, and per-label reasons', () => {
    render(
      <ParcelResultCard parcel={testParcel()} retired={undefined} result={testResult()} />,
    );
    expect(screen.getByTestId('result-status')).toHaveTextContent('PARTIAL');
    expect(screen.getByTestId('result-decoded')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('result-instances')).toHaveTextContent('1');
    expect(screen.getByTestId('result-payloads')).toHaveTextContent('KTY-123');
    expect(screen.getByTestId('result-ack-latency')).toHaveTextContent('300 ms');
    expect(screen.getByTestId('result-label-L-0002')).toHaveTextContent(
      'NO_OBSERVATION',
    );
  });

  it('renders the pending state before finalize', () => {
    render(<ParcelResultCard parcel={testParcel()} retired={undefined} result={undefined} />);
    expect(screen.getByTestId('result-pending')).toBeInTheDocument();
    expect(screen.getByTestId('result-expected')).toHaveTextContent('1');
  });
});

describe('LiveMetrics', () => {
  it('renders the live run metrics', () => {
    render(
      <LiveMetrics
        metrics={zeroMetrics()}
        spawned={5}
        noReads={1}
        droppedFrames={12}
      />,
    );
    expect(screen.getByTestId('metrics-evaluated')).toHaveTextContent('2 / 5');
    expect(screen.getByTestId('metrics-complete-read')).toHaveTextContent('50.0%');
    expect(screen.getByTestId('metrics-recall')).toHaveTextContent('75.0%');
    expect(screen.getByTestId('metrics-no-reads')).toHaveTextContent('1');
    expect(screen.getByTestId('metrics-dropped-frames')).toHaveTextContent('12');
    expect(screen.getByTestId('metrics-exit-result-p95')).toHaveTextContent('260');
  });
});
