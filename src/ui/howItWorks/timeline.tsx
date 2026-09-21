/**
 * Story timeline (t2-2): the bottom strip of the How It Works page.
 *
 * 8 numbered storyboard steps. After step 2 the track branches into the
 * LINE-SCAN lane (steps 3-4) and the 2D-CAMERA lane (steps 5-6); both
 * lanes merge at step 7 (association). The strip carries the always-on
 * parcel chip and the full playback control set (one clock, driven by
 * the parent via the playback store).
 */

import type { ReplayManifest } from './replayManifest';
import { SPEED_OPTIONS, type PlaybackSpeed } from './playbackStore';

/** Storyboard step titles (1-based, matches the 8-row plan storyboard). */
export const STEP_TITLES: readonly string[] = [
  'Parcel enters',
  'Line-scan capture',
  'Line-scan prep',
  'Line-scan decode',
  'Side-camera capture',
  'Side-image prep',
  'Assign reads',
  'Combine & finish',
];

export interface StoryTimelineProps {
  manifest: ReplayManifest;
  /** 1-based active step (derived from the clock by the parent). */
  activeStep: number;
  timeMs: number;
  playing: boolean;
  speed: PlaybackSpeed;
  parcelId: string;
  onScrub: (tMs: number) => void;
  onSeekStep: (step: number) => void;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onRestart: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
}

/** Lane membership: steps 3-4 line scan, 5-6 2D camera, 7 is the merge. */
function laneFor(step: number): 'main' | 'line' | 'area' {
  if (step === 3 || step === 4) return 'line';
  if (step === 5 || step === 6) return 'area';
  return 'main';
}

export function StoryTimeline({
  manifest,
  activeStep,
  timeMs,
  playing,
  speed,
  parcelId,
  onScrub,
  onSeekStep,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onRestart,
  onSpeedChange,
}: StoryTimelineProps) {
  return (
    <div className="story-timeline" data-testid="story-timeline">
      <div className="story-chip" data-testid="parcel-chip">
        <span className="story-chip-label">parcel</span>
        {parcelId}
      </div>

      <div className="story-track" role="list" aria-label="Storyboard steps">
        {STEP_TITLES.map((title, i) => {
          const step = i + 1;
          const lane = laneFor(step);
          const active = step === activeStep;
          return (
            <div
              key={step}
              role="listitem"
              className={`story-step story-step-${lane}${active ? ' story-step-active' : ''}${
                step === 7 ? ' story-step-merge' : ''
              }`}
              data-testid={`step-${step}`}
            >
              <button
                type="button"
                className="story-step-btn"
                aria-current={active ? 'step' : undefined}
                onClick={() => onSeekStep(step)}
              >
                <span className="story-step-num">{step}</span>
              </button>
              <span className="story-step-title">{title}</span>
              {lane === 'line' && (
                <span className="story-lane story-lane-line" aria-hidden="true">
                  line scan
                </span>
              )}
              {lane === 'area' && (
                <span className="story-lane story-lane-area" aria-hidden="true">
                  2D camera
                </span>
              )}
              {step === 7 && (
                <span className="story-merge-tag" aria-hidden="true">
                  merge
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="story-controls" data-testid="playback-controls">
        <button
          type="button"
          className="story-ctrl"
          data-testid="ctrl-restart"
          aria-label="Restart"
          title="Restart"
          onClick={onRestart}
        >
          ⟲
        </button>
        <button
          type="button"
          className="story-ctrl"
          data-testid="ctrl-step-back"
          aria-label="Step back"
          title="Step back"
          onClick={onStepBackward}
        >
          ⏮
        </button>
        <button
          type="button"
          className="story-ctrl story-ctrl-play"
          data-testid="ctrl-play-pause"
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          onClick={onTogglePlay}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          className="story-ctrl"
          data-testid="ctrl-step-fwd"
          aria-label="Step forward"
          title="Step forward"
          onClick={onStepForward}
        >
          ⏭
        </button>
        <input
          className="story-scrub"
          data-testid="scrub"
          type="range"
          min={0}
          max={manifest.durationMs}
          step={10}
          value={timeMs}
          aria-label="Scrub replay time"
          onChange={(e) => onScrub(Number(e.target.value))}
        />
        <label className="story-speed">
          <span>speed</span>
          <select
            data-testid="speed-select"
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value) as PlaybackSpeed)}
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
