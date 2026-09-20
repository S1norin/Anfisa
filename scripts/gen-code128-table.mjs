/* global console */
/**
 * Derive the Code 128 symbol table that bwip-js actually emits, so the
 * pixel decoder (src/pipeline/pixelDecoder.ts) can decode this app's
 * rendered label textures exactly.
 *
 * Why derive instead of hardcoding the ISO table:
 *   - bwipp (the C core behind bwip-js) uses LEGACY Code 128 numbering:
 *     A start = 103, B start = 104, C start = 105, stop = 106 (ISO uses
 *     102 for C start).
 *   - Its pattern table contains 4-wide elements (legacy table, not the
 *     ISO 15417 table).
 *   - Its checksum is POSITION-WEIGHTED:
 *         csum = (start + sum_i data[i] * i) mod 103     (i starts at 1)
 *     ISO 15417 uses the unweighted sum — real scanners may reject
 *     bwip-generated Code 128. The decoder mirrors bwip's formula so
 *     this app's labels decode (PIPE-010 / issue #17).
 *
 * Verification (no external reference needed):
 *   - all 100 pure-C pair payloads render as [105, v, check, 106];
 *   - all 95 pure-B char payloads render as [104, v, check, 106];
 *   - mixed payloads use latches B->C = 99 and C->B = 100;
 *   - every rendering's check symbol equals the weighted formula;
 *   - all 107 patterns are distinct, sum to 11 modules (stop + guard 2).
 *
 * Run: node scripts/gen-code128-table.mjs   (writes src/pipeline/code128Table.ts)
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as bwip from 'bwip-js';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Extract the pattern table from bwip-js's compiled core (source of truth). */
function extractEncs() {
  const src = readFileSync(join(HERE, '..', 'node_modules', 'bwip-js', 'src', 'bwipp.js'), 'utf8');
  const i = src.indexOf('code128_encs');
  const s = src.indexOf('["', i);
  const e = src.indexOf('"]', s);
  return src
    .slice(s + 2, e)
    .split('", "')
    .map((x) => x.replace(/^"/, '').replace(/"$/, ''));
}

/** Parse bwip code128 SVG (vertical bar paths) into symbol values. */
function symbolValues(svg, encs) {
  const bars = [];
  for (const m of svg.matchAll(/<path stroke="[^"]*" stroke-width="(\d+)" d="([^"]*)"/g)) {
    const w = Number(m[1]);
    for (const lm of m[2].matchAll(/M([\d.]+) [\d.]+L[\d.]+ [\d.]+/g)) {
      bars.push([Number(lm[1]) - w / 2, Number(lm[1]) + w / 2]);
    }
  }
  bars.sort((a, b) => a[0] - b[0]);
  const runs = [bars[0][0]];
  for (let i = 0; i < bars.length; i++) {
    runs.push(bars[i][1] - bars[i][0]);
    if (i + 1 < bars.length) runs.push(bars[i + 1][0] - bars[i][1]);
  }
  const n = (runs.length - 2) / 6; // quiet + 6 per symbol + 2-module guard
  if (!Number.isInteger(n)) throw new Error(`bad run count ${runs.length}`);
  if (runs[runs.length - 1] !== 2) throw new Error('stop guard must be 2 modules');
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = runs.slice(1 + 6 * k, 1 + 6 * k + 6).join('');
    if (p === '233111') out.push(106);
    else {
      const idx = encs.indexOf(p);
      if (idx < 0) throw new Error(`pattern not in table: ${p}`);
      out.push(idx);
    }
  }
  return out;
}

/** bwip's (legacy, position-weighted) checksum. */
function weightedCheck(vals) {
  let csum = vals[0];
  for (let i = 1; i < vals.length - 2; i++) csum += vals[i] * i;
  return csum % 103;
}

function expect(text, encs, payload) {
  const svg = bwip.toSVG({ bcid: 'code128', text, includetext: false, padding: 10, scale: 1 });
  const vals = symbolValues(svg, encs);
  if (vals[vals.length - 1] !== 106) throw new Error(`${text}: missing stop`);
  if (weightedCheck(vals) !== vals[vals.length - 2])
    throw new Error(`${text}: checksum mismatch`);
  const data = vals.slice(1, -2);
  if (JSON.stringify(data) !== JSON.stringify(payload))
    throw new Error(`${text}: payload mismatch ${JSON.stringify(data)} != ${JSON.stringify(payload)}`);
  return vals;
}

const encs = extractEncs();
if (encs.length !== 107) throw new Error(`table size ${encs.length}, expected 107`);
if (encs[106] !== '2331112') throw new Error('stop entry must be 2331112 (6 elems + guard)');
if (new Set(encs).size !== 107) throw new Error('duplicate patterns in table');

// 100 pure-C pairs: [105, v, check, 106]
for (let v = 0; v < 100; v++) {
  expect(String(v).padStart(2, '0'), encs, [v]);
}
// 95 pure-B chars (space .. '_'): [104, v, check, 106]
for (let v = 0; v < 95; v++) {
  expect(String.fromCharCode(32 + v), encs, [v]);
}
// Mixed payloads pin the latches: B->C = 99, C->B = 100
expect('KTY-1234', encs, [43, 52, 57, 13, 99, 12, 34]);
expect('KTY-0000', encs, [43, 52, 57, 13, 99, 0, 0]);
expect('123456AB', encs, [12, 34, 56, 100, 33, 34]);
expect('12345678ABCD', encs, [12, 34, 56, 78, 100, 33, 34, 35, 36]);
expect('AB12CD34EF', encs, [33, 34, 17, 18, 35, 36, 19, 20, 37, 38]);
expect('KTY-00001234567890', encs, [43, 52, 57, 13, 99, 0, 0, 12, 34, 56, 78, 90]);
expect('0123456789012345678901234567890123456789', encs, [
  1, 23, 45, 67, 89, 1, 23, 45, 67, 89, 1, 23, 45, 67, 89, 1, 23, 45, 67, 89,
]);

const patterns = encs.map((s) => {
  const digits = (s.length === 7 ? s.slice(0, 6) : s).split('').map(Number);
  if (digits.length !== 6) throw new Error(`bad pattern ${s}`);
  if (digits.reduce((a, b) => a + b, 0) !== 11) throw new Error(`pattern ${s} does not sum to 11`);
  return digits;
});

const lines = [
  '/**',
  ' * Code 128 symbol table as emitted by bwip-js (the generator that renders',
  ' * every label in this app). DERIVED and verified by',
  ' * `node scripts/gen-code128-table.mjs` — do not hand-edit; regenerate if',
  ' * bwip-js changes.',
  ' *',
  ' * IMPORTANT — this is bwip\'s LEGACY table, not the ISO 15417 table:',
  ' *  - legacy start values: A = 103, B = 104, C = 105 (ISO uses 102 for C);',
  ' *  - the table contains 4-wide elements;',
  ' *  - bwip\'s checksum is position-weighted:',
  ' *        csum = (start + sum_i data[i] * i) mod 103,   i = 1..n-1',
  ' *    (ISO 15417 uses the unweighted sum; compliant scanners may reject',
  ' *     bwip-generated Code 128 — the decoder mirrors bwip on purpose so',
  ' *     this app\'s synthetic labels decode; PIPE-010).',
  ' *  - stop = value 106 = [2,3,3,1,1,1] followed by a 2-module guard.',
  ' */',
  '',
  'export const CODE128_START_A = 103;',
  'export const CODE128_START_B = 104;',
  'export const CODE128_START_C = 105;',
  'export const CODE128_STOP = 106;',
  'export const CODE128_STOP_GUARD_MODULES = 2;',
  '',
  '/**',
  ' * bwip latches: [from] -> [to] value. B->C and C->B are pinned by the',
  ' * mixed-payload renders above (99 / 100); A-mode latches are unreachable',
  ' * for this app\'s payload alphabet (bwip auto never enters A mode for it).',
  ' */',
  'export const CODE128_LATCH_A_B = 100;',
  'export const CODE128_LATCH_A_C = 99;',
  'export const CODE128_LATCH_B_A = 101;',
  'export const CODE128_LATCH_B_C = 99;',
  'export const CODE128_LATCH_C_A = 101;',
  'export const CODE128_LATCH_C_B = 100;',
  '',
  '/** FNC (non-data) values the decoder must reject. */',
  'export const CODE128_FNC3 = 96;',
  'export const CODE128_FNC2 = 97;',
  'export const CODE128_SHIFT = 98;',
  'export const CODE128_FNC1 = 102;',
  '',
  '/** Symbol value -> 6 element widths (bar,space,bar,space,bar,space), 1-4, sum 11. Entry index = symbol value. */',
  'export const CODE128_PATTERNS: readonly (readonly [number, number, number, number, number, number])[] = [',
  ...patterns.map((p) => `  [${p.join(', ')}],`),
  '];',
  '',
];

const out = join(HERE, '..', 'src', 'pipeline', 'code128Table.ts');
writeFileSync(out, lines.join('\n'));
console.log(`wrote ${out}: 107 patterns, 100 C + 95 B + 6 mixed payloads verified`);
