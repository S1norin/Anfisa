import { render, screen } from '@testing-library/react';
import { App } from '../App';

describe('App shell', () => {
  it('renders the header title', () => {
    render(<App />);
    expect(screen.getByTestId('app-title')).toHaveTextContent('Anfisa');
  });

  it('renders exactly one nav link (How it works)', () => {
    render(<App />);
    const nav = document.querySelector('nav[aria-label="Primary"]')!;
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('How It Works');
  });

  it('defaults to the How It Works view', () => {
    render(<App />);
    expect(screen.getByTestId('how-it-works-view')).toBeInTheDocument();
  });

  it('deep link: #/operations still renders the Operations view', () => {
    window.location.hash = '#/operations';
    render(<App />);
    expect(screen.getByTestId('operations-view')).toBeInTheDocument();
  });

  it('deep link: #/camera-lab, #/schema, #/metrics still render without error', () => {
    for (const [hash, testid] of [
      ['#/camera-lab', 'camera-lab-view'],
      ['#/schema', 'schema-view'],
      ['#/metrics', 'metrics-view'],
    ] as const) {
      window.location.hash = hash;
      const { unmount } = render(<App />);
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      unmount();
    }
  });
});
