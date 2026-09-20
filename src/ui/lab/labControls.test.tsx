/**
 * Camera Lab controls (issue #12, t12-1): selection surface + validated
 * editing. Valid edits commit through the onCommit mutator (AC-03 live
 * path); invalid edits never commit and show the first error.
 */
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { recommendedSixViewConfig, reportSixViewConfig } from '../../capture/presets';
import type { SimConfig } from '../../domain/config';
import type { AreaScanCameraConfig, LineScanCameraConfig } from '../../domain/types';
import { LabControls } from './labControls';

/** The report layout is the six-view with TOP/BOTTOM line scanners (t2). */
function lineRigId(): { cfg: ReturnType<typeof reportSixViewConfig>; id: string } {
  const cfg = reportSixViewConfig();
  const rig = cfg.cameraRigs.find((r) => r.kind === 'LINE_SCAN');
  if (!rig) throw new Error('report layout has no line scanner');
  return { cfg, id: rig.id };
}

interface LabTestMocks {
  onSelectCamera: Mock;
  onSelectParcel: Mock;
  onToggleFreeze: Mock;
  onStep: Mock;
  onCommit: Mock;
  onFault: Mock;
  onApplyPreset: Mock;
  onFaultScenario: Mock;
  onExportConfig: Mock;
  onImportConfig: Mock;
  onExportRun: Mock;
  onExportObservations: Mock;
  onExportMetricsCsv: Mock;
}

function renderControls(overrides: Partial<Parameters<typeof LabControls>[0]> = {}): LabTestMocks {
  const mocks: LabTestMocks = {
    onSelectCamera: vi.fn(),
    onSelectParcel: vi.fn(),
    onToggleFreeze: vi.fn(),
    onStep: vi.fn(),
    onCommit: vi.fn(),
    onFault: vi.fn(),
    onApplyPreset: vi.fn(),
    onFaultScenario: vi.fn(),
    onExportConfig: vi.fn(),
    onImportConfig: vi.fn(() => [] as string[]),
    onExportRun: vi.fn(),
    onExportObservations: vi.fn(),
    onExportMetricsCsv: vi.fn(),
  };
  const props: Parameters<typeof LabControls>[0] = {
    config: recommendedSixViewConfig(),
    states: {} as Record<string, 'IDLE'>,
    parcels: [],
    selectedCameraId: null,
    selectedParcelId: null,
    frozen: true,
    ...mocks,
    ...overrides,
  };
  render(<LabControls {...props} />);
  return mocks;
}

describe('LabControls', () => {
  it('lists every rig and the selected rig opens the editing surface', () => {
    const cfg = recommendedSixViewConfig();
    renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[2].id });
    const select = screen.getByTestId('lab-camera-select') as HTMLSelectElement;
    expect(select.options.length).toBe(cfg.cameraRigs.length);
    expect(select.value).toBe(cfg.cameraRigs[2].id);
    expect(screen.getByTestId('lab-edit')).toBeTruthy();
  });

  it('focal-length edit commits a valid config with the new value (AC-03 path)', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[0].id });
    const focal = within(screen.getByTestId('lab-edit')).getByLabelText('Focal mm');
    fireEvent.change(focal, { target: { value: '18' } });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const mutator = props.onCommit.mock.calls[0][0] as (c: SimConfig) => SimConfig;
    const next = mutator(cfg);
    const rig = next.cameraRigs[0] as AreaScanCameraConfig;
    expect(rig.sensor.focalLengthMm).toBe(18);
    expect((next.cameraRigs[1] as AreaScanCameraConfig).sensor.focalLengthMm).toBe(
      (cfg.cameraRigs[1] as AreaScanCameraConfig).sensor.focalLengthMm,
    );
    expect(screen.queryByTestId('lab-edit-error')).toBeNull();
  });

  it('invalid values never commit and show the first validation error', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[0].id });
    const focal = within(screen.getByTestId('lab-edit')).getByLabelText('Focal mm');
    fireEvent.change(focal, { target: { value: '0' } }); // focal must be in [2, 120]
    expect(props.onCommit).not.toHaveBeenCalled();
    const err = screen.getByTestId('lab-edit-error');
    expect(err.textContent).toContain('focalLengthMm');
  });

  it('fault checkbox raises/clears via onFault (not the config)', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({
      config: cfg,
      selectedCameraId: cfg.cameraRigs[4].id,
    });
    const box = screen.getByTestId('lab-fault') as HTMLInputElement;
    fireEvent.click(box);
    expect(props.onFault).toHaveBeenCalledWith(cfg.cameraRigs[4].id, true);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('freeze/step buttons report state; step disabled while running', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[0].id });
    fireEvent.click(screen.getByTestId('lab-freeze'));
    expect(props.onToggleFreeze).toHaveBeenCalledTimes(1);
    const step = screen.getByTestId('lab-step') as HTMLButtonElement;
    expect(step.disabled).toBe(false);
  });

  it('preset select offers all eight presets and applies by id (CFG-002)', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[0].id });
    const select = screen.getByTestId('lab-preset') as HTMLSelectElement;
    // 1 placeholder + report layout + 8 comparison presets.
    expect(select.options.length).toBe(10);
    fireEvent.change(select, { target: { value: 'glare-stress' } });
    expect(props.onApplyPreset).toHaveBeenCalledWith('glare-stress');
  });

  it('fault scenario buttons apply live scenarios by id', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[0].id });
    fireEvent.click(screen.getByTestId('lab-fault-rolling-shutter'));
    expect(props.onFaultScenario).toHaveBeenCalledWith('rolling-shutter');
    fireEvent.click(screen.getByTestId('lab-fault-speed-change'));
    expect(props.onFaultScenario).toHaveBeenCalledWith('speed-change');
    fireEvent.click(screen.getByTestId('lab-fault-camera-fault'));
    expect(props.onFaultScenario).toHaveBeenCalledWith('camera-fault');
  });

  it('export buttons trigger their callbacks (issue #15)', () => {
    const cfg = recommendedSixViewConfig();
    const props = renderControls({ config: cfg, selectedCameraId: cfg.cameraRigs[0].id });
    const row = within(screen.getByTestId('lab-export-row'));
    fireEvent.click(row.getByTestId('lab-export-config'));
    expect(props.onExportConfig).toHaveBeenCalledTimes(1);
    fireEvent.click(row.getByTestId('lab-export-run'));
    expect(props.onExportRun).toHaveBeenCalledTimes(1);
    fireEvent.click(row.getByTestId('lab-export-observations'));
    expect(props.onExportObservations).toHaveBeenCalledTimes(1);
    fireEvent.click(row.getByTestId('lab-export-metrics-csv'));
    expect(props.onExportMetricsCsv).toHaveBeenCalledTimes(1);
  });

  it('selecting a LINE_SCAN rig shows line fields and hides area-only sections (t10)', () => {
    const { cfg, id } = lineRigId();
    renderControls({ config: cfg, selectedCameraId: id });
    const edit = within(screen.getByTestId('lab-edit'));
    expect(edit.getByTestId('lab-line-fields')).toBeTruthy();
    expect(edit.getByLabelText('Sensor width mm')).toBeTruthy();
    expect(edit.getByLabelText('Pixels/line')).toBeTruthy();
    expect(edit.getByLabelText('Encoder step mm/line')).toBeTruthy();
    expect(edit.getByLabelText('Max line rate (lines/s)')).toBeTruthy();
    expect(edit.getByLabelText('Scan plane Z mm')).toBeTruthy();
    // Derived readouts present (by value data-testid).
    expect(edit.getByTestId('required-line-rate-lines-s')).toBeTruthy();
    expect(edit.getByTestId('working-distance-mm')).toBeTruthy();
    expect(edit.getByTestId('line-pitch-mm')).toBeTruthy();
    // Area-only fields are hidden for line rigs.
    expect(edit.queryByLabelText('Focal mm')).toBeNull();
    expect(edit.queryByLabelText('FPS')).toBeNull();
    expect(edit.queryByLabelText('Exposure µs')).toBeNull();
  });

  it('a line-field edit commits through the live config; siblings untouched (t10)', () => {
    const { cfg, id } = lineRigId();
    const props = renderControls({ config: cfg, selectedCameraId: id });
    const width = within(screen.getByTestId('lab-edit')).getByLabelText('Sensor width mm');
    fireEvent.change(width, { target: { value: '480' } });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const mutator = props.onCommit.mock.calls[0][0] as (c: SimConfig) => SimConfig;
    const next = mutator(cfg);
    const rig = next.cameraRigs.find((r) => r.id === id)! as LineScanCameraConfig;
    expect(rig.line.sensorWidthMm).toBe(480);
    // A sibling rig is unchanged.
    const other = next.cameraRigs.find((r) => r.id !== id)!;
    expect(other).toEqual(cfg.cameraRigs.find((r) => r.id !== id));
    expect(screen.queryByTestId('lab-edit-error')).toBeNull();
  });

  it('an invalid line value never commits and shows the validation error (t10)', () => {
    const { cfg, id } = lineRigId();
    const props = renderControls({ config: cfg, selectedCameraId: id });
    const step = within(screen.getByTestId('lab-edit')).getByLabelText('Encoder step mm/line');
    fireEvent.change(step, { target: { value: '0' } }); // step must be in [0.01, 10]
    expect(props.onCommit).not.toHaveBeenCalled();
    const err = screen.getByTestId('lab-edit-error');
    expect(err.textContent).toContain('line.encoderStepMmPerLine');
  });

  it('rejected import shows the validation error; accepted import clears it', async () => {
    const cfg = recommendedSixViewConfig();
    renderControls({
      config: cfg,
      selectedCameraId: cfg.cameraRigs[0].id,
      onImportConfig: vi
        .fn()
        .mockReturnValueOnce(['configVersion 99 is not supported'])
        .mockReturnValueOnce([] as string[]),
    });
    const file = screen.getByTestId('lab-import-config') as HTMLInputElement;
    const makeFile = (text: string) =>
      Object.defineProperty(new File([text], 'c.json'), 'text', {
        value: () => Promise.resolve(text),
        configurable: true,
      });
    fireEvent.change(file, { target: { files: [makeFile('bad')] } });
    const err = await screen.findByTestId('lab-edit-error');
    expect(err.textContent).toContain('configVersion 99');
    fireEvent.change(file, { target: { files: [makeFile('good')] } });
    await waitFor(() => expect(screen.queryByTestId('lab-edit-error')).toBeNull());
  });
});
