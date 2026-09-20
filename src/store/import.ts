/**
 * Config import into the live store (issue #15, CFG-003/CFG-007):
 * parse a versioned config file, validate it, then reset the run with it.
 * Importing a config is always a RUN RESET (like applying a preset): the
 * previous run's results/observations are discarded, so an imported file
 * reproduces the exact run it describes (CFG-004).
 */

import { parseConfigImport } from '../export/json';
import type { SimStore } from './simStore';

export type ImportOutcome =
  | { ok: true; seed: number }
  | { ok: false; errors: string[] };

/**
 * Parse + validate the file text, and on success reset the store with the
 * imported config. Returns the outcome for UI feedback.
 */
export function importConfigIntoStore(store: SimStore, text: string): ImportOutcome {
  const result = parseConfigImport(text);
  if (!result.ok) return { ok: false, errors: result.errors };
  store.reset(result.config);
  return { ok: true, seed: result.config.seed };
}
