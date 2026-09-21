/**
 * Named presets + fault scenarios (issue #14, CFG-002).
 *
 * Every preset is a pure function of (id, seed) → a full, validated
 * SimConfig (CFG-003): nothing hidden, everything JSON-round-trippable.
 * Applying a preset RESETS the run with that config, so the same preset +
 * seed always reproduces the same run (CFG-004). Effects propagate through
 * the normal capture → observation → pipeline path — there is no
 * preset-specific processing branch.
 *
 * Fault scenarios (rolling shutter, speed change) are LIVE config mutations
 * (no reset): they change the running config so the effects propagate
 * through the same normal processing path.
 */

import {
  aim,
  recommendedSixViewConfig,
  recommendedSixViewRigs,
  reportEightReaderConfig,
  reportSixViewConfig,
} from '../capture/presets';
import { defaultConfig, validateConfig, type SimConfig } from '../domain/config';
import type { CameraConfig, CameraRole } from '../domain/types';
import type { SimStore } from '../store/simStore';

export const DEFAULT_PRESET_SEED = 2026;

export interface PresetDef {
  id: string;
  name: string;
  description: string;
  /** Category for grouping in the UI. */
  category: 'RIG' | 'STRESS' | 'FAILURE';
  /** Pure: same seed → identical config (CFG-004). */
  build: (seed?: number) => SimConfig;
}

/** Shared rig geometry helpers (station/parcel defaults from the seed config). */
function obliqueRigs(cfg: SimConfig): CameraConfig[] {
  const cz = cfg.station.lengthMm / 2;
  const midY = cfg.parcel.heightMm / 2;
  const halfW = cfg.parcel.widthMm / 2;
  const frontZ = cz + cfg.parcel.lengthMm / 2;
  const rearZ = cz - cfg.parcel.lengthMm / 2;

  // 4 oblique readers at the parcel's diagonal corners, elevated, all
  // looking at the parcel centre (a cheaper draft layout: no top/bottom).
  const wd = 850;
  const sin45 = Math.SQRT1_2;
  const cos45 = Math.SQRT1_2;
  const target: [number, number, number] = [0, midY, cz];
  const by = (role: CameraRole) => recommendedSixViewRigs(cfg).find((r) => r.role === role)!;

  return [
    aim(by('FRONT'), [wd * sin45, midY + wd * sin45, frontZ + wd * cos45], target),
    aim(by('REAR'), [wd * sin45, midY + wd * sin45, rearZ - wd * cos45], target),
    aim(by('LEFT'), [-(halfW + wd * cos45), midY + wd * sin45, cz - wd * sin45], target),
    aim(by('RIGHT'), [halfW + wd * cos45, midY + wd * sin45, cz + wd * sin45], target),
  ];
}

function withRigs(cfg: SimConfig, rigs: CameraConfig[]): SimConfig {
  return { ...cfg, cameraRigs: rigs };
}

export const PRESETS: readonly PresetDef[] = [
  {
    id: 'report-8reader',
    name: 'Report layout · 6 side + 2 line (final)',
    description:
      'The final report layout: six side area cameras at 60° directions (36 mm sensors, 55 mm lens, 1450 mm working distance) plus top/bottom line scanners (715 mm FOV, 8192 px, 0.1 mm step, 12 kHz), 0.35 mm module, and the 100 mm bottom transfer gap. Every value from src/report/reportSpec.ts.',
    category: 'RIG',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = reportEightReaderConfig();
      cfg.seed = seed;
      return cfg;
    },
  },
  {
    id: 'report-6view',
    name: 'Report layout · 4 oblique + top/bottom (legacy)',
    description:
      'Legacy draft layout: four horizontal 45° side views, dedicated top/bottom readers, and two conveyor sections separated by a 100 mm optical gap. Superseded by report-8reader (see REPORT_ALIGNMENT_PLAN.md).',
    category: 'RIG',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = reportSixViewConfig();
      cfg.seed = seed;
      return cfg;
    },
  },
  {
    id: 'recommended-6view',
    name: 'Recommended 6-view',
    description:
      'One reader per face, stopped-down, deep DoF. The easy baseline: 100% synthetic complete read (MET-001).',
    category: 'RIG',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = recommendedSixViewConfig();
      cfg.seed = seed;
      return cfg;
    },
  },
  {
    id: 'draft-4-oblique',
    name: 'Draft 4-oblique (legacy demo)',
    description:
      'Legacy demo layout — not the report geometry: four elevated oblique readers at the parcel corners; no top/bottom. Cheaper layout, oblique incidence on every face. Superseded by report-8reader (see REPORT_ALIGNMENT_PLAN.md).',
    category: 'RIG',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = recommendedSixViewConfig();
      cfg.seed = seed;
      return withRigs(cfg, obliqueRigs(cfg));
    },
  },
  {
    id: 'bottom-gap',
    name: 'Bottom gap transfer',
    description:
      'Recommended 6-view with a GAP bottom transfer: the belt deck occludes the bottom face except a 100 mm opening, so bottom labels are only captured while crossing the gap (AC-05).',
    category: 'RIG',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = recommendedSixViewConfig();
      cfg.seed = seed;
      cfg.station.bottomTransfer = 'GAP';
      return cfg;
    },
  },
  {
    id: 'side-grip',
    name: 'Side-grip transfer',
    description:
      'Recommended 6-view with SIDE_GRIP transfer: no deck under the transfer zone, so the BOTTOM reader sees the full bottom face (AC-05).',
    category: 'RIG',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = recommendedSixViewConfig();
      cfg.seed = seed;
      cfg.station.bottomTransfer = 'SIDE_GRIP';
      return cfg;
    },
  },
  {
    id: 'glare-stress',
    name: 'Glare stress',
    description:
      'Report layout with glossy tape on every parcel, unpolarized wide-open area readers, and high ambient leak on every light (area and line): the glare component drives NO_READs.',
    category: 'STRESS',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = reportEightReaderConfig();
      cfg.seed = seed;
      cfg.parcel.material = 'WHITE_CARD';
      cfg.parcel.tapeChance = 1;
      cfg.parcel.labelDamageChance = 0;
      cfg.cameraRigs = cfg.cameraRigs.map((r) => {
        if (r.kind === 'LINE_SCAN') {
          // Line rigs only carry an illumination block (no strobe, no
          // optics): toggle the line lights only.
          return {
            ...r,
            illumination: {
              ...r.illumination,
              polarized: false,
              ambientLeak: 0.7,
              intensity: 1.2,
            },
          };
        }
        return {
          ...r,
          illumination: {
            ...r.illumination,
            polarized: false,
            ambientLeak: 0.7,
            intensity: 1.2,
          },
          optics: { ...r.optics, apertureProxy: 2.8 },
          imageEffects: {
            ...r.imageEffects,
            shotNoise: 0.3,
            readNoise: 0.1,
            compression: 0.2,
          },
        };
      });
      return cfg;
    },
  },
  {
    id: 'lateral-offset-stress',
    name: 'Lateral offset stress · guide limit',
    description:
      'Report layout with the parcel pushed 120 mm sideways — inside the 125 mm upstream-guide range (650 mm belt, 400 mm parcel): the off-centre faces sit at the working-distance edge and the side readers see them at the worst-case incidence.',
    category: 'STRESS',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = reportEightReaderConfig();
      cfg.seed = seed;
      cfg.parcel.lateralOffsetMm = 120;
      return cfg;
    },
  },
  {
    id: 'small-module-stress',
    name: 'Small-module stress',
    description:
      '0.3 mm Code 128 modules with the bare default rig geometry (short working distance): projected PPM falls below the gate on most faces.',
    category: 'STRESS',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = defaultConfig();
      cfg.seed = seed;
      cfg.barcode.xDimensionMm = 0.3;
      return cfg;
    },
  },
  {
    id: 'camera-failure',
    name: 'Camera failure',
    description:
      'Report layout with the TOP line scanner disabled in config: top-face labels are never captured, so top-face parcels can NO_READ.',
    category: 'FAILURE',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = reportEightReaderConfig();
      cfg.seed = seed;
      cfg.cameraRigs = cfg.cameraRigs.map((r) =>
        r.role === 'TOP' ? { ...r, enabled: false, name: `${r.name} (offline)` } : r,
      );
      return cfg;
    },
  },
  {
    id: 'close-spacing',
    name: 'Close spacing',
    description:
      'Recommended 6-view with 600 ms front-to-front spacing (≈600 mm at 1 m/s): parcels nearly touch — association stress (REV-05).',
    category: 'STRESS',
    build: (seed = DEFAULT_PRESET_SEED) => {
      const cfg = recommendedSixViewConfig();
      cfg.seed = seed;
      cfg.parcel.spawnIntervalMs = 600;
      return cfg;
    },
  },
];

export function getPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Build a preset config, throwing on an unknown id. */
export function applyPresetConfig(id: string, seed?: number): SimConfig {
  const preset = getPreset(id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  return preset.build(seed);
}

export interface FaultScenarioDef {
  id: string;
  name: string;
  description: string;
  /** Live mutation of the running config (no reset). */
  apply: (store: SimStore) => void;
}

export const FAULT_SCENARIOS: readonly FaultScenarioDef[] = [
  {
    id: 'rolling-shutter',
    name: 'Rolling shutter (all area readers)',
    description:
      'Switches every area reader to ROLLING readout: temporal smear grows with belt speed (CAM-004/IMG-004). Line scanners are encoder-synced and have no shutter.',
    apply: (store) =>
      store.updateConfig((cfg) => ({
        ...cfg,
        cameraRigs: cfg.cameraRigs.map((r) =>
          r.kind === 'AREA_SCAN'
            ? { ...r, acquisition: { ...r.acquisition, shutter: 'ROLLING' as const } }
            : r,
        ),
      })),
  },
  {
    id: 'speed-change',
    name: 'Speed change → 1.5 m/s',
    description:
      'Raises belt speed mid-run (SIM-004): motion blur and capture windows change while encoder-delta association holds.',
    apply: (store) => store.setSpeed(1500),
  },
  {
    id: 'camera-fault',
    name: 'Camera fault (first reader)',
    description:
      'Raises a FAULT on the first reader (CAM-009): its captures stop and the feed wall warns; clearing returns it to IDLE.',
    apply: (store) => {
      const id = store.sim.state.config.cameraRigs[0]?.id;
      if (id) store.setCameraFault(id, true);
    },
  },
];

export function getFaultScenario(id: string): FaultScenarioDef | undefined {
  return FAULT_SCENARIOS.find((f) => f.id === id);
}

/**
 * Apply a named preset by resetting the live store with a fresh preset
 * config (CFG-004 reproducibility). Returns the applied preset.
 */
export function applyPresetToStore(store: SimStore, id: string, seed?: number): PresetDef {
  const preset = getPreset(id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  store.reset(preset.build(seed));
  return preset;
}

/** Validate helper for tests/UI: every preset must pass CFG-001. */
export function validateAllPresets(): Record<string, { path: string; message: string }[]> {
  const out: Record<string, { path: string; message: string }[]> = {};
  for (const p of PRESETS) out[p.id] = validateConfig(p.build());
  return out;
}
