/**
 * How It Works view (t12, tutorial): the teaching surface.
 *
 * - Step rail: 11 stages as real buttons with keyboard prev/next (t11's
 *   processGuide).
 * - Diagram: lightweight HTML/CSS flow (no WebGL).
 * - Evidence cards: per-stage status for the selected parcel from t11's
 *   pure processEvidence mapping (read-only — the view never mutates the
 *   simulation).
 * - Parcel selector defaults to "follow newest"; Technical details
 *   disclosure; accuracy callout (analytic decode, not GPU preview).
 */

import { useMemo, useState } from 'react';
import { simStore, useSim } from '../../store/simStore';
import type { SimEvent } from '../../domain/types';
import { PROCESS_GUIDE } from '../process/processGuide';
import { processEvidence, type ObservationEvidence } from '../process/processEvidence';
import { ProcessStepRail } from '../process/processStepRail';
import { ProcessDiagram } from '../process/processDiagram';
import { ProcessEvidenceCard } from '../process/processEvidenceCard';

const FOLLOW_NEWEST = '__follow_newest__';

function parcelEvents(events: readonly SimEvent[], parcelId: string): SimEvent[] {
  return events.filter((e) => {
    switch (e.type) {
      case 'CAMERA_CAPTURED':
        return e.candidateParcelIds.includes(parcelId);
      default:
        return 'parcelId' in e && e.parcelId === parcelId;
    }
  });
}

const STATUS_LABEL: Record<string, string> = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
};

export function HowItWorksView() {
  const sim = useSim();
  const { state } = sim;
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedParcel, setSelectedParcel] = useState<string>(FOLLOW_NEWEST);
  const [showTechnical, setShowTechnical] = useState(false);

  const liveParcels = [...state.parcels.values()];
  const newestId = liveParcels.length > 0 ? liveParcels[liveParcels.length - 1].parcelId : null;

  // Selector options: follow-newest + every live parcel (newest first).
  const options = [
    FOLLOW_NEWEST,
    ...liveParcels.map((p) => p.parcelId).reverse(),
  ];
  const effectiveParcelId =
    selectedParcel === FOLLOW_NEWEST ? newestId : selectedParcel;

  const evidence = useMemo(() => {
    if (!effectiveParcelId) return null;
    const observations: ObservationEvidence[] = simStore.liveObservations
      .filter((o) => o.parcelId === effectiveParcelId)
      .map((o) => ({
        decoded: o.decoded,
        qualityPassed: o.qualityPassed,
        reasons: o.reasons,
      }));
    const result = simStore.resultFor(effectiveParcelId);
    return processEvidence({
      parcelId: effectiveParcelId,
      events: parcelEvents(state.events, effectiveParcelId),
      observations,
      result: result
        ? {
            status: result.status,
            expectedLabels: result.expectedLabels,
            decodedLabels: result.decodedLabels,
          }
        : undefined,
    });
  }, [effectiveParcelId, state.events, state]);

  const stage = PROCESS_GUIDE[currentStep];

  return (
    <div className="view view-how-it-works" data-testid="how-it-works-view">
      <div className="how-header">
        <h2>How It Works</h2>
        <span
          className={`run-indicator run-indicator-${state.status.toLowerCase()}`}
          data-testid="run-indicator"
        >
          {STATUS_LABEL[state.status] ?? state.status}
        </span>
        <label className="how-parcel-select">
          Parcel
          <select
            data-testid="parcel-select"
            value={selectedParcel}
            onChange={(e) => setSelectedParcel(e.target.value)}
          >
            {options.map((id) => (
              <option key={id} value={id}>
                {id === FOLLOW_NEWEST ? 'Follow newest' : id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="how-accuracy-callout" data-testid="accuracy-callout">
        Decode accuracy here is ANALYTIC — geometric projection plus a
        deterministic quality model. The strip preview is display-only; it
        is never the input to decode.
      </p>

      <div className="how-layout">
        <ProcessStepRail current={currentStep} onSelect={setCurrentStep} />

        <div className="how-main">
          <ProcessDiagram activeStageId={stage.id} />

          {effectiveParcelId && evidence ? (
            <div className="how-evidence" data-testid="evidence-panel">
              <div className="how-evidence-title" data-testid="evidence-parcel">
                {effectiveParcelId}
                <span className="how-evidence-counts">
                  {' '}· {evidence.captureCount} capture
                  {evidence.captureCount === 1 ? '' : 's'}, {evidence.decodedCount} decoded
                </span>
                {evidence.finalStatus && (
                  <span
                    className={`how-final how-final-${evidence.finalStatus.toLowerCase()}`}
                    data-testid="evidence-final"
                  >
                    {evidence.finalStatus}
                  </span>
                )}
              </div>
              {PROCESS_GUIDE.map((g, i) => (
                <ProcessEvidenceCard
                  key={g.id}
                  stage={g}
                  evidence={evidence.stages[i]}
                  active={i === currentStep}
                />
              ))}
            </div>
          ) : (
            <div className="how-evidence-empty" data-testid="evidence-empty">
              No parcel selected — parcels appear here as the run spawns them.
            </div>
          )}

          <button
            type="button"
            className="how-technical-toggle"
            data-testid="technical-toggle"
            aria-expanded={showTechnical}
            onClick={() => setShowTechnical((v) => !v)}
          >
            {showTechnical ? 'Hide' : 'Show'} technical details
          </button>
          {showTechnical && (
            <div className="how-technical" data-testid="technical-details">
              <p>
                Line scans are encoder-synchronized: each line is captured at a
                known encoder position (encoderStepMmPerLine), so the strip is
                a deterministic (encoder, cross-belt) image of the parcel.
                Association uses interval overlap of the parcel's encoder span
                against the strip span; decode is a pure function of the
                projected strip region (no GPU pixels).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
