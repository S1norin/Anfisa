/**
 * Camera Lab controls (issue #12, t12-1): selection surface + validated
 * editing. Valid edits commit through the onCommit mutator (AC-03 live
 * path); invalid edits never commit and show the first error.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { recommendedSixViewConfig } from '../../capture/presets';
import type { SimConfig } from '../../domain/config';
import { LabControls } from './labControls';

interface LabTestMocks {
  onSelectCamera: Mock;
  onSelectParcel: Mock;
  onToggleFreeze: Mock;
  onStep: Mock;
  onCommit: Mock;
  onFault: Mock;
}

function renderControls(
  overrides: Partial<Parameters<typeof LabControls>[0]> = {},
): LabTestMocks {
  const mocks: LabTestMocks = {
    onSelectCamera: vi.fn(),
    onSelectParcel: vi.fn(),
    onToggleFreeze: vi.fn(),
    onStep: vi.fn(),
    onCommit: vi.fn(),
    onFault: vi.fn(),
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
    const rig = next.cameraRigs[0];
    expect(rig.sensor.focalLengthMm).toBe(18);
    expect(next.cameraRigs[1].sensor.focalLengthMm).toBe(
      cfg.cameraRigs[1].sensor.focalLengthMm,
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
});
