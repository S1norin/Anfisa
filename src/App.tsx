import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/layout';
import { ErrorBoundary } from './app/errorBoundary';
import { OperationsView } from './ui/views/operationsView';
import { CameraLabView } from './ui/views/cameraLabView';
import { SchemaView } from './ui/views/schemaView';
import { MetricsView } from './ui/views/metricsView';

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/operations" replace />} />
            <Route path="/operations" element={<OperationsView />} />
            <Route path="/camera-lab" element={<CameraLabView />} />
            <Route path="/schema" element={<SchemaView />} />
            <Route path="/metrics" element={<MetricsView />} />
            <Route path="*" element={<Navigate to="/operations" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
