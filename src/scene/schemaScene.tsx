/**
 * Schema-view 3D scene (issue #13): a schematic, low-clutter render of the
 * station with the six key dimension lines, per-rig frusta/axes/ROIs, scan
 * zones, focus planes, angle arcs, and label annotations. Orthographic
 * presets keep dimensions readable; annotation text is drawn to canvas
 * textures (sprites) so it is captured by the PNG export.
 *
 * Geometry comes from pure world-mm functions in schemaData.ts; everything
 * here only converts mm→m and draws.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import * as THREE from 'three';
import { mmToM } from '../domain/units';
import type { CameraState, ParcelState } from '../domain/types';
import type { SimConfig } from '../domain/config';
import { frustumCornersMm } from '../domain/camera';
import { StationScene } from './stationScene';
import { ParcelScene } from './parcel';
import { FrustumLines } from './frustumHelper';
import { schemaPresets, type SchemaPreset } from './schemaPresets';
import {
  dimensionLines,
  focusPlaneCorners,
  incidenceArc,
  labelAnnotations,
  opticalAxes,
  roiCorners,
  scanZones,
  yawArc,
  type V3,
} from './schemaData';
import { exportPng } from '../export/screenshot';

export interface SchemaToggles {
  dimensions: boolean;
  frusta: boolean;
  scanZones: boolean;
  focusPlanes: boolean;
  axes: boolean;
  roi: boolean;
  arcs: boolean;
  labels: boolean;
}

export const DEFAULT_SCHEMA_TOGGLES: SchemaToggles = {
  dimensions: true,
  frusta: true,
  scanZones: true,
  focusPlanes: false,
  axes: false,
  roi: false,
  arcs: true,
  labels: true,
};

export interface SchemaSceneApi {
  /** Render the current frame and return it as a PNG blob (null on failure,
   * e.g. no WebGL in the test environment). */
  exportPng: () => Promise<Blob | null>;
  /** Re-fit the active preset to the station extent. */
  fit: () => void;
}

const toM = (p: V3): [number, number, number] => [
  mmToM(p[0]),
  mmToM(p[1]),
  mmToM(p[2]),
];
const toMpts = (pts: V3[]): [number, number, number][] => pts.map(toM);

/**
 * Annotation text on a canvas texture: unlike drei's <Html> portal (which
 * renders into the DOM and would be missing from a canvas.toDataURL export)
 * the text lives in the GL frame.
 */
function makeTextTexture(text: string, sub?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = (px: number) => `600 ${px}px Inter, system-ui, sans-serif`;
  ctx.font = font(30);
  const mainW = ctx.measureText(text).width;
  let subW = 0;
  if (sub) {
    ctx.font = font(24);
    subW = ctx.measureText(sub).width;
  }
  const w = Math.ceil(Math.max(mainW, subW) + 28);
  const h = sub ? 30 + 24 + 26 : 30 + 24;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  ctx.strokeStyle = 'rgba(120, 150, 190, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2f6fb';
  ctx.font = font(30);
  ctx.textBaseline = 'top';
  ctx.fillText(text, 14, 9);
  if (sub) {
    ctx.fillStyle = '#9fb2c8';
    ctx.font = font(24);
    ctx.fillText(sub, 14, 45);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface TextSpriteProps {
  position: [number, number, number];
  text: string;
  sub?: string;
  /** Sprite height in world metres. */
  height?: number;
}

function TextSprite({ position, text, sub, height = 0.11 }: TextSpriteProps) {
  const tex = useMemo(() => makeTextTexture(text, sub), [text, sub]);
  useEffect(() => () => tex.dispose(), [tex]);
  const img = tex.image as HTMLCanvasElement;
  const aspect = img.width / Math.max(1, img.height);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={20}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  );
}

/** Short perpendicular tick at a dimension-line endpoint. */
function endpointTick(
  from: [number, number, number],
  to: [number, number, number],
): [[number, number, number], [number, number, number]] {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const dir: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
  const up: [number, number, number] = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const cross: [number, number, number] = [
    dir[1] * up[2] - dir[2] * up[1],
    dir[2] * up[0] - dir[0] * up[2],
    dir[0] * up[1] - dir[1] * up[0],
  ];
  const cl = Math.hypot(cross[0], cross[1], cross[2]) || 1;
  const t = 0.035;
  const px = cross[0] / cl;
  const py = cross[1] / cl;
  const pz = cross[2] / cl;
  return [
    [from[0] + px * t, from[1] + py * t, from[2] + pz * t],
    [from[0] - px * t, from[1] - py * t, from[2] - pz * t],
  ];
}

interface DimLineProps {
  from: V3;
  to: V3;
  label: string;
}

function DimensionLine({ from, to, label }: DimLineProps) {
  const f = toM(from);
  const t = toM(to);
  const mid: [number, number, number] = [
    (f[0] + t[0]) / 2,
    (f[1] + t[1]) / 2,
    (f[2] + t[2]) / 2,
  ];
  const ticks = useMemo(() => [endpointTick(f, t), endpointTick(t, f)], [f, t]);
  return (
    <group>
      <Line points={[f, t]} color="#d8dee7" lineWidth={1.4} transparent opacity={0.9} />
      {ticks.map((pair, i) => (
        <Line key={i} points={pair} color="#d8dee7" lineWidth={1.4} transparent opacity={0.9} />
      ))}
      <TextSprite position={[mid[0], mid[1] + 0.04, mid[2]]} text={label} height={0.085} />
    </group>
  );
}

interface ScanZoneBoxProps {
  center: V3;
  halfExtentsLocal: [number, number, number];
  quaternion: [number, number, number, number];
  label: string;
}

function ScanZoneBox({ center, halfExtentsLocal, quaternion, label }: ScanZoneBoxProps) {
  const pos = toM(center);
  const ext: [number, number, number] = [
    mmToM(halfExtentsLocal[0] * 2),
    mmToM(halfExtentsLocal[1] * 2),
    mmToM(halfExtentsLocal[2] * 2),
  ];
  const quat = useMemo(
    () => new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
    [quaternion],
  );
  return (
    <group>
      <mesh position={pos} quaternion={quat}>
        <boxGeometry args={ext} />
        <meshBasicMaterial color="#4f8cff" transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <mesh position={pos} quaternion={quat}>
        <boxGeometry args={ext} />
        <meshBasicMaterial color="#4f8cff" wireframe transparent opacity={0.22} />
      </mesh>
      <TextSprite position={pos} text={label} height={0.085} />
    </group>
  );
}

interface FocusPlaneProps {
  corners: V3[];
  color?: string;
}

function FocusPlaneRect({ corners, color = '#35d07f' }: FocusPlaneProps) {
  const pts = toMpts(corners);
  const center: [number, number, number] = [
    pts.reduce((s, p) => s + p[0], 0) / 4,
    pts.reduce((s, p) => s + p[1], 0) / 4,
    pts.reduce((s, p) => s + p[2], 0) / 4,
  ];
  const edgeA: [number, number, number] = [
    pts[1][0] - pts[0][0],
    pts[1][1] - pts[0][1],
    pts[1][2] - pts[0][2],
  ];
  const edgeB: [number, number, number] = [
    pts[3][0] - pts[0][0],
    pts[3][1] - pts[0][1],
    pts[3][2] - pts[0][2],
  ];
  const normal = new THREE.Vector3(...edgeA).cross(new THREE.Vector3(...edgeB)).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  return (
    <group>
      <mesh position={center} quaternion={quat}>
        <planeGeometry args={[Math.hypot(...edgeA), Math.hypot(...edgeB)]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={[...pts, pts[0]]}
        color={color}
        lineWidth={1.2}
        transparent
        opacity={0.65}
      />
    </group>
  );
}

interface AngleArcLineProps {
  points: V3[];
  label: string;
  color: string;
}

function AngleArcLine({ points, label, color }: AngleArcLineProps) {
  if (points.length < 2) {
    // Degenerate (head-on incidence): a single sprite at the point.
    const p = toM(points[0]);
    return <TextSprite position={[p[0], p[1] + 0.05, p[2]]} text={label} height={0.08} />;
  }
  const pts = toMpts(points);
  const labelPos = toM(points[Math.floor(pts.length / 2)]);
  return (
    <group>
      <Line points={pts} color={color} lineWidth={1.6} transparent opacity={0.95} />
      <TextSprite
        position={[labelPos[0], labelPos[1] + 0.045, labelPos[2]]}
        text={label}
        height={0.08}
      />
    </group>
  );
}

interface LabelAnnotationGroupProps {
  center: V3;
  normalEnd: V3;
  distanceLine: { from: V3; to: V3; label: string };
  projected: string;
}

function LabelAnnotationGroup({
  center,
  normalEnd,
  distanceLine,
  projected,
}: LabelAnnotationGroupProps) {
  const c = toM(center);
  const n = toM(normalEnd);
  const dFrom = toM(distanceLine.from);
  const dTo = toM(distanceLine.to);
  const mid: [number, number, number] = [
    (dFrom[0] + dTo[0]) / 2,
    (dFrom[1] + dTo[1]) / 2,
    (dFrom[2] + dTo[2]) / 2,
  ];
  return (
    <group>
      <Line points={[c, n]} color="#ffd166" lineWidth={1.8} transparent opacity={0.95} />
      <Line
        points={[dFrom, dTo]}
        color="#9fb2c8"
        lineWidth={1}
        dashed
        dashSize={0.05}
        gapSize={0.03}
        transparent
        opacity={0.8}
      />
      <TextSprite position={[mid[0], mid[1], mid[2]]} text={distanceLine.label} height={0.075} />
      <TextSprite position={[c[0], c[1] + 0.09, c[2]]} text={projected} height={0.075} />
    </group>
  );
}

type FitFn = () => void;

/**
 * Applies the active preset (camera position, ortho fit to the station box,
 * orbit target) on preset/station/size changes, and registers itself as the
 * `fit()` target for the public API.
 */
function FitController({
  preset,
  stationLengthMm,
  fitFnRef,
}: {
  preset: SchemaPreset;
  stationLengthMm: number;
  fitFnRef: React.MutableRefObject<FitFn | null>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3;
    update?: () => void;
  } | null;

  useEffect(() => {
    const apply = () => {
      const L = stationLengthMm / 1000;
      const box = new THREE.Box3(
        new THREE.Vector3(-1.1, -0.15, -1.1),
        new THREE.Vector3(1.1, 2.3, L + 1.1),
      );
      camera.position.set(...preset.position);
      if ('zoom' in camera) {
        const ortho = camera as THREE.OrthographicCamera;
        camera.updateMatrixWorld();
        const inv = camera.matrixWorldInverse.clone();
        const xs: number[] = [];
        const ys: number[] = [];
        [box.min.x, box.max.x].forEach((x) =>
          [box.min.y, box.max.y].forEach((y) =>
            [box.min.z, box.max.z].forEach((z) => {
              const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
              xs.push(v.x);
              ys.push(v.y);
            }),
          ),
        );
        const extW = Math.max(...xs) - Math.min(...xs);
        const extH = Math.max(...ys) - Math.min(...ys);
        const aspect = size.width / Math.max(1, size.height);
        ortho.left = -aspect;
        ortho.right = aspect;
        ortho.top = 1;
        ortho.bottom = -1;
        ortho.zoom =
          Math.min(size.width / Math.max(extW, 1e-6), size.height / Math.max(extH, 1e-6)) *
          0.92;
        ortho.updateProjectionMatrix();
      }
      if (controls?.target && controls.update) {
        controls.target.set(...preset.target);
        controls.update();
      }
    };
    apply();
    fitFnRef.current = apply;
    return () => {
      if (fitFnRef.current === apply) fitFnRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, stationLengthMm, size, camera]);

  return null;
}

/** Per-rig × per-label annotation groups (schemaData returns per-label). */
function labelAnnotationGroups(
  config: SimConfig,
  parcel: ParcelState,
): {
  key: string;
  center: V3;
  normalEnd: V3;
  distanceLine: { from: V3; to: V3; label: string };
  projected: string;
}[] {
  const out: {
    key: string;
    center: V3;
    normalEnd: V3;
    distanceLine: { from: V3; to: V3; label: string };
    projected: string;
  }[] = [];
  for (const rig of config.cameraRigs) {
    if (!rig.enabled) continue;
    for (const a of labelAnnotations(rig, parcel)) {
      out.push({ key: `${rig.id}:${a.labelInstanceId}`, ...a });
    }
  }
  return out;
}

export interface SchemaSceneProps {
  config: SimConfig;
  parcel: ParcelState | null;
  presetName: SchemaPreset['name'];
  toggles: SchemaToggles;
  cameraStates?: Record<string, CameraState>;
  /** Receives the scene API (PNG export + fit) once the canvas is ready. */
  onApi?: (api: SchemaSceneApi) => void;
}

export function SchemaScene({
  config,
  parcel,
  presetName,
  toggles,
  cameraStates,
  onApi,
}: SchemaSceneProps) {
  const presets = useMemo(
    () => schemaPresets(config.station.lengthMm),
    [config.station.lengthMm],
  );
  const preset = presets[presetName];
  const fitFnRef = useRef<FitFn | null>(null);

  const dims = useMemo(() => dimensionLines(config, parcel), [config, parcel]);
  const zones = useMemo(() => scanZones(config.cameraRigs), [config.cameraRigs]);
  const axes = useMemo(() => opticalAxes(config.cameraRigs), [config.cameraRigs]);
  const labelGroups = useMemo(
    () => (parcel ? labelAnnotationGroups(config, parcel) : []),
    [config, parcel],
  );
  const yaw = useMemo(() => (parcel ? yawArc(parcel) : null), [parcel]);

  const rigState = (id: string): CameraState => cameraStates?.[id] ?? 'IDLE';

  const parcelTopCentre: V3 | null = parcel
    ? [
        mmToM(parcel.spec.lateralOffsetMm),
        mmToM(parcel.spec.heightMm),
        mmToM(parcel.frontZMm - parcel.spec.lengthMm / 2),
      ]
    : null;

  return (
    <div
      className="schema-scene"
      data-testid="schema-scene"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onCreated={({ gl, scene, camera }) => {
          onApi?.({
            exportPng: () => exportPng(gl, scene, camera),
            fit: () => fitFnRef.current?.(),
          });
        }}
      >
        <color attach="background" args={['#12161c']} />
        {presetName === 'ISO' ? (
          <PerspectiveCamera
            makeDefault
            position={preset.position}
            fov={40}
            near={0.05}
            far={100}
          />
        ) : (
          <OrthographicCamera makeDefault position={preset.position} zoom={1} />
        )}
        <ambientLight intensity={0.95} />
        <directionalLight position={[4, 6, 3]} intensity={0.4} />
        <StationScene config={config} schematic />
        {parcel && <ParcelScene state={parcel} schematic />}

        {toggles.dimensions &&
          dims.map((d) => (
            <DimensionLine key={d.id} from={d.from} to={d.to} label={d.label} />
          ))}

        {toggles.frusta &&
          config.cameraRigs.map((rig) =>
            rig.enabled ? (
              <FrustumLines
                key={rig.id}
                cornersM={toMpts(frustumCornersMm(rig))}
                color={rigState(rig.id) === 'FAULT' ? '#ff5c5c' : '#4f8cff'}
                opacity={0.55}
              />
            ) : null,
          )}

        {toggles.axes &&
          axes.map((a) => (
            <Line
              key={a.rigId}
              points={[toM(a.from), toM(a.to)]}
              color="#35d07f"
              lineWidth={1.2}
              dashed
              dashSize={0.08}
              gapSize={0.05}
              transparent
              opacity={0.85}
            />
          ))}

        {toggles.scanZones &&
          zones.map((z) => (
            <ScanZoneBox
              key={z.rigId}
              center={z.center}
              halfExtentsLocal={z.halfExtentsLocal}
              quaternion={z.quaternion}
              label={z.label}
            />
          ))}

        {toggles.focusPlanes &&
          config.cameraRigs
            .filter((r) => r.enabled)
            .map((r) => <FocusPlaneRect key={r.id} corners={focusPlaneCorners(r)} />)}

        {toggles.roi &&
          config.cameraRigs
            .filter((r) => r.enabled)
            .map((r) => {
              const c = roiCorners(r);
              if (!c) return null;
              const pts = toMpts(c);
              return (
                <Line
                  key={`${r.id}-roi`}
                  points={[...pts, pts[0]]}
                  color="#ffd166"
                  lineWidth={1.4}
                  transparent
                  opacity={0.9}
                />
              );
            })}

        {toggles.arcs &&
          parcel &&
          parcelTopCentre &&
          config.cameraRigs
            .filter((r) => r.enabled)
            .flatMap((r) => {
              const hasTopLabel = parcel.spec.labels.some((l) => l.face === 'TOP');
              if (!hasTopLabel) return [];
              const arc = incidenceArc(
                parcelTopCentre,
                [0, 1, 0],
                r.pose.positionMm,
                140,
              );
              return [
                <AngleArcLine
                  key={`${r.id}-inc`}
                  points={arc.points}
                  label={arc.label}
                  color="#ff5c5c"
                />,
              ];
            })}
        {toggles.arcs && yaw && (
          <AngleArcLine points={yaw.points} label={yaw.label} color="#35d07f" />
        )}

        {toggles.labels &&
          labelGroups.map((a) => (
            <LabelAnnotationGroup
              key={a.key}
              center={a.center}
              normalEnd={a.normalEnd}
              distanceLine={a.distanceLine}
              projected={a.projected}
            />
          ))}

        <OrbitControls
          makeDefault
          target={preset.target}
          maxPolarAngle={Math.PI / 2 - 0.02}
          minDistance={0.5}
          maxDistance={20}
        />
        <FitController
          preset={preset}
          stationLengthMm={config.station.lengthMm}
          fitFnRef={fitFnRef}
        />
      </Canvas>
    </div>
  );
}
