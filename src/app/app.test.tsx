import { render, screen } from '@testing-library/react';
import { App } from '../App';

describe('App shell', () => {
  it('renders the header title', () => {
    render(<App />);
    expect(screen.getByTestId('app-title')).toHaveTextContent('Anfisa');
  });

  it('renders navigation to all four views', () => {
    render(<App />);
    const nav = document.querySelector('nav[aria-label="Primary"]')!;
    expect(nav).toHaveTextContent('Operations');
    expect(nav).toHaveTextContent('Camera Lab');
    expect(nav).toHaveTextContent('Schema');
    expect(nav).toHaveTextContent('Metrics');
  });

  it('defaults to the Operations view', () => {
    render(<App />);
    expect(screen.getByTestId('operations-view')).toBeInTheDocument();
  });

  it('renders the 3D canvas area on the Operations view (fallback without WebGL)', () => {
    render(<App />);
    expect(screen.getByTestId('scene-canvas-fallback')).toBeInTheDocument();
  });
});
