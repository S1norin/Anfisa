/**
 * How It Works shell (t2-2): the 3-panel teaching layout.
 *
 * ONE playback clock (playbackStore) drives everything: the 3D parcel
 * pose is interpolated from the manifest keyframes, the right panel
 * shows the step's capture placeholder, and the bottom timeline
 * (StoryTimeline) is the transport. No step content lives here —
 * steps P3–P6 replace the placeholders.
 *
 * Panels:
 *  - left:  3D station (orbit camera or a fixed top/side/sensor view)
 *  - right: per-step image placeholder (capture meta only)
 *  - bottom: story timeline + parcel chip + playback controls
 *
 * Mode switch: Guided Replay (this shell) vs Live Processing (explicit
 * "not available yet" until the P7 module lands).
 */

import { useLayoutEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { mmToM } from '../../domain/units';
import { defaultConfig } from '../../domain/config';
import type { ParcelState } from '../../domain/types';
import { StationScene } from '../../scene/stationScene';
import { CameraRigScene } from '../../scene/cameraRig';
import { ParcelScene } from '../../scene/parcel';
import type { ReplayManifest, CaptureRecord } from './replayManifest';
import { REPLAY_FIXTURES, type FixtureId } from './fixtures';
import {
  Step1Entry,
  PhotoeyeEntryHighlight,
  sceneHighlightAt,
  hasCrossedPhotoeye,
} from './step1Entry';
import {
  usePlayback,
  stepIndexAt,
  type PlaybackSpeed,
  type PlaybackStore,
} from './playbackStore';
import { StoryTimeline } from './timeline';
import { StripView, lineScanPayload } from './stripView';

export type HiwMode = 'guided' | 'live';
export type HiwViewPreset = 'orbit' | 'top' | 'side' | 'sensor';

/** Fixed-view look targets (metres, station coordinates). */
const TOP_CAMERA_POS: [number, number, number] = [0, 3.2, 0.8];
const TOP_TARGET: [number, number, number] = [0, 0.25, 0.8];
const SIDE_CAMERA_POS: [number, number, number] = [2.1, 1.5, 0.8];
const SIDE_TARGET: [number, number, number] = [0, 0.3, 0.8];

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/** Interpolate the parcel front-Z from manifest keyframes at story time t. */
export function parcelFrontZAt(
  keyframes: readonly { tMs: number; frontZMm: number }[],
  tMs: number,
): number {
  if (tMs <= keyframes[0].tMs) return keyframes[0].frontZMm;
  const last = keyframes[keyframes.length - 1];
  if (tMs >= last.tMs) return last.frontZMm;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (tMs >= a.tMs && tMs <= b.tMs) {
      const f = b.tMs === a.tMs ? 0 : (tMs - a.tMs) / (b.tMs - a.tMs);
      return a.frontZMm + (b.frontZMm - a.frontZMm) * f;
    }
  }
  return last.frontZMm;
}

/** Build the renderable ParcelState for the story parcel at time t. */
export function storyParcelAt(manifest: ReplayManifest, tMs: number): ParcelState {
  return {
    parcelId: manifest.parcel.parcelId,
    spec: {
      widthMm: 250,
      heightMm: 220,
      lengthMm: 350,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: true,
      labels: manifest.parcel.labels.map((l) => ({
        labelInstanceId: l.labelInstanceId,
        payload: l.payload,
        face: l.face,
        localOffsetMm: [0, 0] as [number, number],
        rotationDeg: 0,
        widthMm: 180,
        heightMm: 90,
        damage: 0,
      })),
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: manifest.keyframes[0].frontZMm,
    frontZMm: parcelFrontZAt(manifest.keyframes, tMs),
    phase: 'ENTERED',
  };
}

/**
 * Fixed camera preset. `sensor` places the camera at the active step's
 * first rig pose, looking at the parcel plane at that z; `top`/`side`
 * are station viewpoints over the line-scan and side-camera sections.
 */
function FixedViewCamera({
  preset,
  sensorId,
}: {
  preset: Exclude<HiwViewPreset, 'orbit'>;
  sensorId: string | null;
}) {
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);

  const camera = useMemo(() => {
    const rig =
      preset === 'sensor' && sensorId
        ? defaultConfig().cameraRigs.find((r) => r.id === sensorId)
        : undefined;
    let position: [number, number, number];
    let target: [number, number, number];
    if (rig) {
      position = [
        mmToM(rig.pose.positionMm[0]),
        mmToM(rig.pose.positionMm[1]),
        mmToM(rig.pose.positionMm[2]),
      ];
      target = [0, 0.25, mmToM(rig.pose.positionMm[2])];
    } else if (preset === 'top') {
      position = TOP_CAMERA_POS;
      target = TOP_TARGET;
    } else {
      position = SIDE_CAMERA_POS;
      target = SIDE_TARGET;
    }
    const cam = new THREE.PerspectiveCamera(
      45,
      size.width / Math.max(1, size.height),
      0.05,
      100,
    );
    cam.position.set(position[0], position[1], position[2]);
    cam.lookAt(target[0], target[1], target[2]);
    cam.updateProjectionMatrix();
    return cam;
  }, [preset, sensorId, size.width, size.height]);

  useLayoutEffect(() => {
    set({ camera });
  }, [camera, set]);

  return null;
}

/**
 * Left 3D panel: station + camera rigs (active step's first rig
 * highlighted) + the story parcel, under the chosen camera preset.
 */
function HiwScenePanel({
  manifest,
  timeMs,
  view,
}: {
  manifest: ReplayManifest;
  timeMs: number;
  view: HiwViewPreset;
}) {
  const config = useMemo(() => defaultConfig(), []);
  const photoeyeHighlight = sceneHighlightAt(manifest, timeMs) === 'photoeye-entry';
  const stepIdx = stepIndexAt(manifest.steps, manifest.durationMs, timeMs);
  const activeSensors = manifest.steps[stepIdx]?.sensorIds ?? [];
  const highlightId =
    activeSensors.find((id) => config.cameraRigs.some((r) => r.id === id)) ?? null;
  const parcel = storyParcelAt(manifest, timeMs);
  const rigStates = useMemo(
    () =>
      Object.fromEntries(
        config.cameraRigs.map((r) => [
          r.id,
          r.enabled ? ('IDLE' as const) : ('OFFLINE' as const),
        ]),
      ),
    [config],
  );

  if (!hasWebGL()) {
    return (
      <div className="hiw-scene-fallback" data-testid="hiw-scene-fallback">
        3D view unavailable: WebGL is not supported in this browser.
      </div>
    );
  }

  return (
    <Canvas
      data-testid="hiw-scene"
      dpr={[1, 2]}
      camera={{ position: [2.4, 1.6, 3.4], fov: 45, near: 0.05, far: 100 }}
    >
      <color attach="background" args={['#161a20']} />
      <ambientLight intensity={0.22} />
      <directionalLight position={[4, 6, 3]} intensity={0.32} />
      <StationScene config={config} />
      <CameraRigScene
        rigs={config.cameraRigs}
        states={rigStates}
        selectedId={highlightId}
        onSelect={() => undefined}
      />
      <ParcelScene state={parcel} />
      {photoeyeHighlight && <PhotoeyeEntryHighlight beltWidthMm={config.belt.widthMm} />}
      {view === 'orbit' ? (
        <>
          <gridHelper args={[8, 40, '#2f3740', '#222831']} position={[0, -0.8, 1.1]} />
          <OrbitControls
            target={[0, 0.3, 1.1]}
            maxPolarAngle={Math.PI / 2 - 0.02}
            minDistance={0.4}
            maxDistance={12}
          />
        </>
      ) : (
        <FixedViewCamera preset={view} sensorId={highlightId} />
      )}
    </Canvas>
  );
}

/** Right panel: per-step capture placeholder (no step content until P3+). */
function HiwImagePanel({
  manifest,
  timeMs,
}: {
  manifest: ReplayManifest;
  timeMs: number;
}) {
  const stepIdx = stepIndexAt(manifest.steps, manifest.durationMs, timeMs);
  const step = manifest.steps[stepIdx];
  if (step.step === 1) {
    return (
      <section className="hiw-image-panel" data-testid="hiw-image-panel">
        <div className="hiw-image-step" data-testid="image-panel-step">
          Step 1 · parcel entry
        </div>
        <Step1Entry manifest={manifest} timeMs={timeMs} />
      </section>
    );
  }
  const capture: CaptureRecord | undefined = manifest.captures.find(
    (c) => c.captureId === step.captureId,
  );
  return (
    <section className="hiw-image-panel" data-testid="hiw-image-panel">
      <div className="hiw-image-step" data-testid="image-panel-step">
        Step {step.step} ·{' '}
        {step.sensorIds.length > 0 ? step.sensorIds.join(', ') : 'parcel travel'}
      </div>
      {capture && capture.kind === 'LINE_SCAN' ? (
        <StripView
          capture={capture}
          payload={lineScanPayload(manifest, capture)}
          frontZMm={parcelFrontZAt(manifest.keyframes, timeMs)}
        />
      ) : capture ? (
        <div className="hiw-image-placeholder" data-testid="image-panel-placeholder">
          <div data-testid="image-panel-capture">{capture.captureId}</div>
          <div className="hiw-image-meta">
            <span>{capture.sensorId}</span>
            <span>{capture.kind}</span>
            <span>
              encoder {capture.encoderSpanMm[0]}–{capture.encoderSpanMm[1]} mm
            </span>
          </div>
          <p className="hiw-image-note">
            Stage imagery for this capture arrives with the step content.
          </p>
        </div>
      ) : (
        <div className="hiw-image-placeholder" data-testid="image-panel-placeholder">
          <p className="hiw-image-note">No capture in this step.</p>
        </div>
      )}
    </section>
  );
}

export interface HiwShellProps {
  store: PlaybackStore;
  manifest: ReplayManifest;
  mode: HiwMode;
  onModeChange: (mode: HiwMode) => void;
  onFixtureChange: (id: FixtureId) => void;
}

export function HiwShell({
  store,
  manifest,
  mode,
  onModeChange,
  onFixtureChange,
}: HiwShellProps) {
  const playback = usePlayback(store);
  const stepIdx = stepIndexAt(manifest.steps, manifest.durationMs, playback.timeMs);
  const activeStep = stepIdx + 1;
  const [viewPreset, setViewPreset] = useState<HiwViewPreset>('orbit');
  // The chip populates only once the parcel crosses the entry photoeye.
  const entered = hasCrossedPhotoeye(manifest.keyframes, playback.timeMs);
  const chipText = entered ? manifest.parcel.parcelId : '— awaiting entry —';

  return (
    <div className="hiw-shell" data-testid="hiw-shell">
      <div className="hiw-topbar">
        <h2>How It Works</h2>
        <label className="hiw-fixture-select">
          sample
          <select
            data-testid="fixture-select"
            value={manifest.fixtureId}
            onChange={(e) => onFixtureChange(e.target.value as FixtureId)}
          >
            {(Object.keys(REPLAY_FIXTURES) as FixtureId[]).map((id) => (
              <option key={id} value={id}>
                {REPLAY_FIXTURES[id]().parcel.label}
              </option>
            ))}
          </select>
        </label>
        <div
          className="hiw-mode-switch"
          role="group"
          aria-label="Replay mode"
          data-testid="mode-switch"
        >
          <button
            type="button"
            data-testid="mode-guided"
            aria-pressed={mode === 'guided'}
            onClick={() => onModeChange('guided')}
          >
            Guided Replay
          </button>
          <button
            type="button"
            data-testid="mode-live"
            aria-pressed={mode === 'live'}
            onClick={() => onModeChange('live')}
          >
            Live Processing
          </button>
        </div>
      </div>

      {mode === 'live' ? (
        <div
          className="hiw-live-unavailable"
          data-testid="live-unavailable"
          role="status"
        >
          Live Processing is not available yet. Use Guided Replay to follow the
          story.
        </div>
      ) : (
        <>
          <div className="hiw-panels">
            <section className="hiw-3d-panel" data-testid="hiw-3d-panel">
              <HiwScenePanel
                manifest={manifest}
                timeMs={playback.timeMs}
                view={viewPreset}
              />
              <div
                className="hiw-view-presets"
                role="group"
                aria-label="3D view"
                data-testid="view-presets"
              >
                {(['orbit', 'top', 'side', 'sensor'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-testid={`view-${p}`}
                    aria-pressed={viewPreset === p}
                    onClick={() => setViewPreset(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>
            <HiwImagePanel manifest={manifest} timeMs={playback.timeMs} />
          </div>
          <StoryTimeline
            manifest={manifest}
            activeStep={activeStep}
            timeMs={playback.timeMs}
            playing={playback.playing}
            speed={playback.speed}
            parcelId={chipText}
            onScrub={(t) => store.scrub(t)}
            onSeekStep={(n) => store.seekStep(manifest.steps, n)}
            onTogglePlay={() => store.toggle()}
            onStepForward={() => store.stepForward(manifest.steps)}
            onStepBackward={() => store.stepBackward(manifest.steps)}
            onRestart={() => store.restart()}
            onSpeedChange={(s: PlaybackSpeed) => store.setSpeed(s)}
          />
        </>
      )}
    </div>
  );
}
