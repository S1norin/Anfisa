/**
 * Emits the asset-generation spec (scripts/hiw-asset-spec.json) from the
 * canonical TS replay fixtures — single source of story truth for
 * scripts/gen_hiw_assets.py (t1-2).
 *
 * Run:  npx vite-node scripts/gen-hiw-spec.ts
 * Deterministic: JSON.stringify of pure fixture builders (no clocks).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildNoReadManifest, buildSuccessManifest } from '../src/ui/howItWorks/fixtures';

const spec = {
  schemaVersion: 1,
  fixtures: {
    success: buildSuccessManifest(),
    'no-read': buildNoReadManifest(),
  },
};

const out = join(dirname(new URL(import.meta.url).pathname), 'hiw-asset-spec.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(spec, null, 2) + '\n');
console.log(`wrote ${out} (${JSON.stringify(spec).length} bytes)`);
