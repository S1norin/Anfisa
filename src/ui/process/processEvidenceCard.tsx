/**
 * processEvidenceCard (t12): one stage card — guide body + live evidence
 * (status, detail, counts) for the selected parcel.
 */

import type { ProcessStage } from './processGuide';
import type { StageEvidence } from './processEvidence';

interface ProcessEvidenceCardProps {
  stage: ProcessStage;
  /** Evidence for this stage (absent → the stage is pending/unknown). */
  evidence?: StageEvidence;
  /** True when this is the currently selected step. */
  active: boolean;
}

const STATUS_LABEL: Record<StageEvidence['status'], string> = {
  pending: 'pending',
  active: 'in progress',
  complete: 'complete',
  failed: 'failed',
};

export function ProcessEvidenceCard({
  stage,
  evidence,
  active,
}: ProcessEvidenceCardProps) {
  const status = evidence?.status ?? 'pending';
  return (
    <div
      className={
        active
          ? 'evidence-card evidence-card-active'
          : 'evidence-card'
      }
      data-testid={`evidence-${stage.id}`}
      data-status={status}
    >
      <div className="evidence-card-head">
        <span className="evidence-card-title">{stage.title}</span>
        <span className={`evidence-status evidence-status-${status}`}>
          {STATUS_LABEL[status]}
        </span>
        {typeof evidence?.count === 'number' && evidence.count > 0 && (
          <span className="evidence-count" data-testid={`count-${stage.id}`}>
            ×{evidence.count}
          </span>
        )}
      </div>
      <p className="evidence-card-body">{stage.body}</p>
      {evidence?.detail && (
        <p className="evidence-card-detail" data-testid={`detail-${stage.id}`}>
          {evidence.detail}
        </p>
      )}
    </div>
  );
}
