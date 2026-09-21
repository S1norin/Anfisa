import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver; R3F's react-use-measure (pulled in
// by @react-three/fiber) requires it whenever a full scene canvas mounts.
// A no-op stub is enough for layout tests — we never assert measured sizes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
