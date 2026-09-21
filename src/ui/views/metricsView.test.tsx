/**
 * MetricsView (t4-labeling): the footer states the processing-mode mix —
 * run records/captures use GEOMETRY_MODEL, the pixel probe PIXEL_DECODER.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricsView } from './metricsView';

describe('MetricsView — mode mix footer (t4-labeling)', () => {
  it('states the GEOMETRY_MODEL / PIXEL_DECODER mix', () => {
    render(<MetricsView />);
    const mode = screen.getByTestId('metrics-mode');
    expect(mode.textContent).toContain('GEOMETRY_MODEL');
    expect(mode.textContent).toContain('PIXEL_DECODER');
  });
});
