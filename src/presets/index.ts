/**
 * Preset module entry (issue #14): named presets + fault scenarios.
 */
export {
  DEFAULT_PRESET_SEED,
  FAULT_SCENARIOS,
  PRESETS,
  applyPresetConfig,
  applyPresetToStore,
  getFaultScenario,
  getPreset,
  validateAllPresets,
  type FaultScenarioDef,
  type PresetDef,
} from './presets';
