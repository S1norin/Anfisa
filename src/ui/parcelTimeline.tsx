/**
 * Selected-parcel pipeline timeline (t11): spawned → entered → captured →
 * decoded → aggregated → finalized → PLC ACK with live stage updates.
 *
 * Reaches are rendered as sim-time stamps + deltas from the previous
 * reached stage; the current stage is highlighted; unreached stages are
 * dimmed. Data comes from the pure derivation in operations/timeline.ts.
 */

import type { TimelineStage } from './operations/timeline';
import { currentTimelineStage } from './operations/timeline';

interface Props {
  parcelId: string | null;
  stages: readonly TimelineStage[];
}

function fmtTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function ParcelTimeline({ parcelId, stages }: Props) {
  if (parcelId === null) {
    return (
      <section className="op-card" data-testid="parcel-timeline">
        <h3>Parcel pipeline</h3>
        <p className="op-card-empty">No parcel on the belt.</p>
      </section>
    );
  }

  const current = currentTimelineStage(stages);

  return (
    <section className="op-card" data-testid="parcel-timeline">
      <h3>
        Parcel pipeline <span className="op-card-id">{parcelId}</span>
      </h3>
      <ol className="timeline">
        {stages.map((stage) => {
          const reached = stage.simTimeMs !== null;
          const isCurrent =
            current !== null && current.id === stage.id;
          let delta = null;
          if (reached) {
            const prev = stages
              .slice(0, stages.indexOf(stage))
              .reverse()
              .find((s) => s.simTimeMs !== null);
            if (prev) delta = stage.simTimeMs! - prev.simTimeMs!;
          }
          return (
            <li
              key={stage.id}
              className={[
                'timeline-stage',
                reached ? 'reached' : 'pending',
                isCurrent ? 'current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={isCurrent ? 'step' : undefined}
              data-testid={`timeline-stage-${stage.id}`}
            >
              <span className="timeline-dot" aria-hidden="true" />
              <span className="timeline-label">{stage.label}</span>
              {reached && (
                <span className="timeline-time" data-testid={`timeline-time-${stage.id}`}>
                  {fmtTime(stage.simTimeMs!)}
                  {delta !== null && delta > 0 && (
                    <em className="timeline-delta"> +{Math.round(delta)} ms</em>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
