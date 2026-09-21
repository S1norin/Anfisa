import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/layout';
import { ErrorBoundary } from './app/errorBoundary';
import { OperationsView } from './ui/views/operationsView';
import { CameraLabView } from './ui/views/cameraLabView';
import { SchemaView } from './ui/views/schemaView';
import { HowItWorksView } from './ui/views/howItWorksView';
import { MetricsView } from './ui/views/metricsView';
import { simStore } from './store/simStore';

/**
 * Display pump: the domain clock advances only through the store's rAF
 * loop (NFR-001: domain steps are fixed-rate; only pump() is coupled to
 * display refresh). Also auto-starts the run so the demo is live on load.
 */
function SimDriver() {
  useEffect(() => {
    if (simStore.sim.state.status === 'IDLE') simStore.start();
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      simStore.tick(now - last);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <SimDriver />
      <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/how-it-works" replace />} />
            <Route path="/operations" element={<OperationsView />} />
            <Route path="/camera-lab" element={<CameraLabView />} />
            <Route path="/schema" element={<SchemaView />} />
            <Route path="/how-it-works" element={<HowItWorksView />} />
            <Route path="/metrics" element={<MetricsView />} />
            <Route path="*" element={<Navigate to="/how-it-works" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
