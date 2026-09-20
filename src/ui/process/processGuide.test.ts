/**
 * processGuide (t11): exactly 11 stages in doc order with the documented
 * group mapping, and no React/Three imports in the model files (AC-3).
 */

import { describe, expect, it } from 'vitest';
import { PROCESS_GUIDE, PROCESS_GROUPS } from './processGuide';

const DOC_ORDER = [
  'created',
  'entry-tracking',
  'reader-triggering',
  'acquisition',
  'preprocessing',
  'quality-gating',
  'decode',
  'association',
  'dedup-aggregation',
  'exit-finalization',
  'plc-ack-sort',
];

const EXPECTED_GROUP: Record<string, string> = {
  created: 'Physical flow',
  'entry-tracking': 'Physical flow',
  'reader-triggering': 'Acquisition',
  acquisition: 'Acquisition',
  preprocessing: 'Preprocessing',
  'quality-gating': 'Decode',
  decode: 'Decode',
  association: 'Postprocessing',
  'dedup-aggregation': 'Postprocessing',
  'exit-finalization': 'Output',
  'plc-ack-sort': 'Output',
};

describe('processGuide (t11)', () => {
  it('exports exactly 11 stages in doc order', () => {
    expect(PROCESS_GUIDE).toHaveLength(11);
    expect(PROCESS_GUIDE.map((s) => s.id)).toEqual(DOC_ORDER);
  });

  it('every stage has a title, a valid group, and a non-trivial body', () => {
    for (const s of PROCESS_GUIDE) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(PROCESS_GROUPS).toContain(s.group);
      expect(s.body.length).toBeGreaterThan(20);
    }
  });

  it('group membership matches the doc mapping', () => {
    for (const s of PROCESS_GUIDE) {
      expect(s.group).toBe(EXPECTED_GROUP[s.id]);
    }
  });

  it('covers all six groups', () => {
    expect(new Set(PROCESS_GUIDE.map((s) => s.group))).toEqual(
      new Set(PROCESS_GROUPS),
    );
  });

  it('model files import neither React nor Three (import scan)', () => {
    const sources = import.meta.glob('/src/ui/process/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(2);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/['"]react['"]/);
      expect(source, file).not.toMatch(/['"]three['"]/);
    }
  });
});
