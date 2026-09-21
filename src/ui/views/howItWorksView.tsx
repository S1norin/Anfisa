/**
 * How It Works view (t2-2): the guided-replay teaching surface.
 *
 * Owns the single PlaybackStore (the ONE clock for the page) and pumps
 * it with requestAnimationFrame; the shell (src/ui/howItWorks/layout.tsx)
 * renders the 3-panel layout, the storyboard timeline, and the
 * Guided Replay / Live Processing mode switch. The sim (live parcels,
 * capture, decode) is NOT involved in the guided replay — the manifest
 * fixtures are the story data.
 */

import { useEffect, useRef, useState } from 'react';
import { HiwShell, type HiwMode } from '../howItWorks/layout';
import { PlaybackStore, usePlayback } from '../howItWorks/playbackStore';
import { REPLAY_FIXTURES } from '../howItWorks/fixtures';

export function HowItWorksView() {
  // One store per mounted view; survives re-renders (stable identity).
  const storeRef = useRef<PlaybackStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new PlaybackStore();
  }
  const store = storeRef.current;
  const playback = usePlayback(store);
  const [mode, setMode] = useState<HiwMode>('guided');
  const manifest = REPLAY_FIXTURES[playback.fixtureId]();

  // Pump the replay clock from the display rAF loop; the domain sim
  // keeps its own pump (App SimDriver) — the two are independent.
  useEffect(() => {
    store.setDuration(manifest.durationMs);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      store.tick(now - last);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [store, manifest]);

  return (
    <div className="view view-how-it-works" data-testid="how-it-works-view">
      <HiwShell
        store={store}
        manifest={manifest}
        mode={mode}
        onModeChange={setMode}
        onFixtureChange={(id) => store.setFixture(id)}
      />
    </div>
  );
}
