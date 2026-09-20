import { it } from 'vitest';
import { applyPresetConfig } from './presets';
import { ProcessRun } from './pipeline/runDriver';
it('ac5 per-obs v2', () => {
  for (const id of ['bottom-gap', 'side-grip'] as const) {
    const run = new ProcessRun(applyPresetConfig(id), 10);
    run.runToCompletion();
    const rec = run.record();
    const byLabel = new Map<string, { total: number; passed: number }>();
    for (const o of rec.observations) {
      if (o.face !== 'BOTTOM') continue;
      const k = `${o.parcelId}:${o.labelInstanceId}`;
      const e = byLabel.get(k) ?? { total: 0, passed: 0 };
      e.total++; if (o.qualityPassed) e.passed++;
      byLabel.set(k, e);
    }
    console.log(id, JSON.stringify([...byLabel.values()]));
  }
});
