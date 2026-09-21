/**
 * DecoderComparison (t4-labeling): the mode legend must name the two
 * processing modes so a reader can tell which produced which column.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DecoderComparison } from './decoderComparison';

describe('DecoderComparison — mode labeling (t4-labeling)', () => {
  it('labels which processing mode produced each result column', () => {
    render(
      <DecoderComparison
        report={null}
        parcel={null}
        cameraId={null}
        simTimeMs={0}
        frozen={false}
        onExperiment={() => {}}
      />,
    );
    const modes = screen.getByTestId('dc-modes');
    expect(modes.textContent).toContain('GEOMETRY_MODEL');
    expect(modes.textContent).toContain('PIXEL_DECODER');
  });
});

describe('DecoderComparison — pixel engine selector (t4-zxing)', () => {
  it('offers the custom TS decoder and the ZXing C++ (wasm) engine', () => {
    render(
      <DecoderComparison
        report={null}
        parcel={null}
        cameraId={null}
        simTimeMs={0}
        frozen={false}
        onExperiment={() => {}}
      />,
    );
    const select = screen.getByTestId('dc-engine-select') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('CUSTOM_TS');
    expect(options).toContain('ZXING_CPP');
    // The custom TS decoder is the default engine.
    expect(select.value).toBe('CUSTOM_TS');
    const banner = screen.getByTestId('dc-banner');
    expect(banner.textContent).toContain('ZXing');
  });
});
