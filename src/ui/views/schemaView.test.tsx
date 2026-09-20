/**
 * Schema view controls (issue #13, t13-1..t13-4): presets, toggle groups,
 * freeze/step/fit/PNG wiring to the sim store and scene API. The WebGL
 * scene is mocked — its geometry is covered in scene/schemaData.test.ts.
 */

import { act, useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simStore } from '../../store/simStore';
import type { SchemaSceneApi, SchemaToggles } from '../../scene/schemaScene';

const mockApi: SchemaSceneApi = {
  exportPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  fit: vi.fn(),
};
const fitMock = mockApi.fit as ReturnType<typeof vi.fn>;
const exportPngMock = mockApi.exportPng as ReturnType<typeof vi.fn>;

vi.mock('../../scene/schemaScene', () => ({
  DEFAULT_SCHEMA_TOGGLES: {
    dimensions: true,
    frusta: true,
    scanZones: true,
    focusPlanes: false,
    axes: false,
    roi: false,
    arcs: true,
    labels: true,
  },
  SchemaScene: ({
    presetName,
    toggles,
    parcel,
    onApi,
  }: {
    presetName: string;
    toggles: SchemaToggles;
    parcel: unknown;
    onApi?: (api: SchemaSceneApi) => void;
  }) => {
    // The real scene registers its API from Canvas onCreated (post-mount).
    useEffect(() => {
      onApi?.(mockApi);
    }, [onApi]);
    return (
      <div
        data-testid="schema-scene"
        data-preset={presetName}
        data-toggles={JSON.stringify(toggles)}
        data-parcel={parcel ? 'yes' : 'no'}
      />
    );
  },
}));

// Import after the mock registration (hoisting-safe: vi.mock is hoisted).
import { SchemaView } from './schemaView';

describe('schema view', () => {
  beforeEach(() => {
    simStore.reset();
    fitMock.mockClear();
    exportPngMock.mockClear();
    // jsdom has no object URLs — stub the download helpers.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('shows presets, all eight toggle groups, and time controls', () => {
    render(<SchemaView />);
    expect(screen.getByTestId('schema-preset-top')).toBeInTheDocument();
    expect(screen.getByTestId('schema-preset-side')).toBeInTheDocument();
    expect(screen.getByTestId('schema-preset-front')).toBeInTheDocument();
    expect(screen.getByTestId('schema-preset-iso')).toBeInTheDocument();
    for (const key of [
      'dimensions',
      'frusta',
      'scanZones',
      'focusPlanes',
      'axes',
      'roi',
      'arcs',
      'labels',
    ] as const) {
      expect(screen.getByTestId(`schema-toggle-${key}`)).toBeInTheDocument();
    }
    // Defaults: focus planes + axes off, everything else on.
    expect(screen.getByTestId('schema-toggle-focusPlanes')).not.toBeChecked();
    expect(screen.getByTestId('schema-toggle-axes')).not.toBeChecked();
    expect(screen.getByTestId('schema-toggle-dimensions')).toBeChecked();

    expect(screen.getByTestId('schema-freeze')).toBeInTheDocument();
    expect(screen.getByTestId('schema-step')).toBeDisabled(); // IDLE
    expect(screen.getByTestId('schema-fit')).toBeInTheDocument();
    expect(screen.getByTestId('schema-export')).toBeEnabled(); // api fires synchronously
  });

  it('toggling a display group updates the scene toggles', () => {
    render(<SchemaView />);
    fireEvent.click(screen.getByTestId('schema-toggle-frusta'));
    expect(screen.getByTestId('schema-scene')).toHaveAttribute(
      'data-toggles',
      expect.stringContaining('"frusta":false'),
    );
  });

  it('selecting a preset updates the scene preset', () => {
    render(<SchemaView />);
    fireEvent.click(screen.getByTestId('schema-preset-iso'));
    expect(screen.getByTestId('schema-scene')).toHaveAttribute('data-preset', 'ISO');
  });

  it('freeze/step drive the sim store (step advances one domain step)', () => {
    render(<SchemaView />);
    act(() => {
      simStore.start();
      simStore.step(400); // 2s: one parcel spawned (default interval)
    });
    expect([...simStore.sim.state.parcels.values()].length).toBeGreaterThan(0);

    // View re-renders on the store version tick; freeze is now actionable.
    fireEvent.click(screen.getByTestId('schema-freeze'));
    expect(simStore.sim.state.status).toBe('PAUSED');

    const step = screen.getByTestId('schema-step');
    expect(step).toBeEnabled();
    const t0 = simStore.sim.state.simTimeMs;
    fireEvent.click(step);
    expect(simStore.sim.state.simTimeMs).toBe(t0 + 5);
    expect(simStore.sim.state.status).toBe('PAUSED');

    // Resume via the same button.
    fireEvent.click(screen.getByTestId('schema-freeze'));
    expect(simStore.sim.state.status).toBe('RUNNING');
  });

  it('fit and PNG export call the scene API', async () => {
    render(<SchemaView />);

    fireEvent.click(screen.getByTestId('schema-fit'));
    expect(fitMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('schema-export'));
    expect(exportPngMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('schema-export-note')).toBeInTheDocument();
  });
});
