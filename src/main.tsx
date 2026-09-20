import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Dev-only automation handle: perf/leak harnesses (NFR-001/003/004/005)
// drive the store from outside React via CDP. Never present in prod builds.
if (import.meta.env.DEV) {
  import('./store/simStore').then(({ simStore }) => {
    (window as unknown as Record<string, unknown>).__anfisaStore = simStore;
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
