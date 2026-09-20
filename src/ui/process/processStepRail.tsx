/**
 * processStepRail (t12): the 11-stage step rail for the How It Works view.
 *
 * Each stage is a REAL <button> (accessible, focusable, clickable). The
 * current step carries aria-current='step' (WAI step-list pattern). Left/
 * Right arrow keys on the rail move to the previous/next step.
 */

import type { KeyboardEvent } from 'react';
import { PROCESS_GUIDE, type ProcessStage } from './processGuide';

interface ProcessStepRailProps {
  /** Index into PROCESS_GUIDE of the current step. */
  current: number;
  onSelect: (index: number) => void;
}

/** Consecutive stages sharing a group are rendered under one group header. */
function groupHeaderAt(index: number): ProcessStage | null {
  if (index === 0) return PROCESS_GUIDE[0];
  const prev = PROCESS_GUIDE[index - 1];
  const cur = PROCESS_GUIDE[index];
  return cur.group === prev.group ? null : cur;
}

export function ProcessStepRail({ current, onSelect }: ProcessStepRailProps) {
  const clamp = (i: number) => Math.max(0, Math.min(PROCESS_GUIDE.length - 1, i));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSelect(clamp(current - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSelect(clamp(current + 1));
    }
  };

  return (
    <div
      className="process-step-rail"
      data-testid="process-step-rail"
      role="group"
      aria-label="Process steps"
      onKeyDown={onKeyDown}
    >
      {PROCESS_GUIDE.map((stage, i) => {
        const header = groupHeaderAt(i);
        return (
          <div key={stage.id}>
            {header && (
              <div className="process-step-group" data-testid={`step-group-${header.group}`}>
                {header.group}
              </div>
            )}
            <button
              type="button"
              className={
                i === current ? 'process-step process-step-current' : 'process-step'
              }
              aria-current={i === current ? 'step' : undefined}
              data-testid={`step-${stage.id}`}
              onClick={() => onSelect(i)}
            >
              <span className="process-step-number">{i + 1}</span>
              {stage.title}
            </button>
          </div>
        );
      })}
      <div className="process-step-nav">
        <button
          type="button"
          className="process-step-prev"
          data-testid="step-prev"
          disabled={current === 0}
          onClick={() => onSelect(clamp(current - 1))}
        >
          ← Prev
        </button>
        <button
          type="button"
          className="process-step-next"
          data-testid="step-next"
          disabled={current === PROCESS_GUIDE.length - 1}
          onClick={() => onSelect(clamp(current + 1))}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
