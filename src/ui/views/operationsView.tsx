/**
 * Operations view (t11, issue #11): the primary presentation view.
 *
 * - Central 3D station: orbit camera, moving parcels with label decals,
 *   photoeyes, sort point, camera status lights; click a parcel to select
 *   (empty-space click clears; auto-follows the newest parcel otherwise).
 * - Camera wall: six feed tiles with live pipeline metadata.
 * - Side panel: pipeline timeline, result card, and live metrics for the
 *   selected parcel / run.
 */

import { useRef, useState } from 'react';
import { SceneCanvas } from '../../scene/sceneCanvas';
import { simStore, useSim } from '../../store/simStore';
import { frameBuffer } from '../../capture/frameBuffer';
import type { RunMetrics } from '../../metrics/metrics';
import { CameraWall } from '../cameraWall';
import { ParcelTimeline } from '../parcelTimeline';
import { ParcelResultCard } from '../parcelResult';
import { LiveMetrics } from '../liveMetrics';
import { parcelTimelineStages } from '../operations/timeline';

/** Metrics recompute at most every 250 ms of sim time (the panel is a
 *  live readout, not a per-frame instrument; keeps tick cost bounded). */
const METRICS_REFRESH_MS = 250;

interface MetricsSnapshot {
  atMs: number;
  metrics: RunMetrics;
  noReads: number;
  droppedFrames: number;
}

function snapshotAt(simTimeMs: number): MetricsSnapshot {
  const metrics = simStore.computeLiveMetrics();
  const noReads = simStore.results.filter((r) => r.status === 'NO_READ').length;
  const events = simStore.sim.state.events;
  let captures = 0;
  for (const e of events) if (e.type === 'CAMERA_CAPTURED') captures += 1;
  // The bounded per-camera buffers keep only the newest 120 frames each;
  // everything captured beyond that was dropped from display.
  let buffered = 0;
  for (const rig of simStore.sim.state.config.cameraRigs) {
    buffered += frameBuffer.frameCount(rig.id);
  }
  return { atMs: simTimeMs, metrics, noReads, droppedFrames: Math.max(0, captures - buffered) };
}

export function OperationsView() {
  const sim = useSim();
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const { config, cameraStates, parcels, finalized, simTimeMs, events } = sim.state;

  const liveParcels = [...parcels.values()];
  const selectedLive = selectedParcelId ? parcels.get(selectedParcelId) : undefined;
  const selectedRetired = selectedParcelId
    ? finalized.find((f) => f.parcelId === selectedParcelId)
    : undefined;

  // Explicit selection wins (survives retirement, so the finished result
  // stays on screen); otherwise auto-follow the newest live parcel.
  const effectiveId =
    selectedLive || selectedRetired
      ? selectedParcelId!
      : liveParcels.length > 0
        ? liveParcels[liveParcels.length - 1].parcelId
        : null;
  const effectiveLive = effectiveId ? parcels.get(effectiveId) : undefined;
  const effectiveRetired = effectiveId
    ? finalized.find((f) => f.parcelId === effectiveId)
    : undefined;

  const result = effectiveId ? simStore.resultFor(effectiveId) : undefined;
  const aggregate = effectiveId ? simStore.aggregateFor(effectiveId) : undefined;

  const stages = effectiveId
    ? parcelTimelineStages({
        parcelId: effectiveId,
        parcel: effectiveLive,
        retired: effectiveRetired,
        result,
        aggregate,
        observations: simStore.liveObservations,
        simEvents: events,
        pipelineEvents: simStore.pipelineEvents,
      })
    : [];

  const snapRef = useRef<MetricsSnapshot | null>(null);
  if (
    snapRef.current === null ||
    simTimeMs - snapRef.current.atMs >= METRICS_REFRESH_MS
  ) {
    snapRef.current = snapshotAt(simTimeMs);
  }
  const snap = snapRef.current;

  return (
    <section className="view view-operations" data-testid="operations-view">
      <div className="view-canvas-col">
        <div className="view-canvas">
          <SceneCanvas
            config={config}
            cameraStates={cameraStates}
            selectedCameraId={selectedCameraId}
            onSelectCamera={setSelectedCameraId}
            parcels={liveParcels}
            selectedParcelId={effectiveId}
            onSelectParcel={setSelectedParcelId}
          />
        </div>
        <CameraWall />
      </div>
      <div className="view-panel">
        <h2>Operations</h2>
        <ParcelTimeline parcelId={effectiveId} stages={stages} />
        <ParcelResultCard
          parcel={effectiveLive}
          retired={effectiveRetired}
          result={result}
        />
        <LiveMetrics
          metrics={snap.metrics}
          spawned={simStore.parcelsSpawned}
          noReads={snap.noReads}
          droppedFrames={snap.droppedFrames}
        />
      </div>
    </section>
  );
}
