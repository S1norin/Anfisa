/**
 * Camera Lab report view (issue #12, t12-2): the geometric readout for
 * the selected rig + parcel — physical FOV at the target plane,
 * distance, incidence angle, projected PPM, estimated blur, coverage,
 * and the current readability reasons (the pipeline's own engine output).
 */

import type { LabReport } from './labReport';

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="lab-metric">
      <span className="lab-metric-k">{k}</span>
      <span className="lab-metric-v" data-testid={k.toLowerCase().replace(/\s+/g, '-')}>{v}</span>
    </div>
  );
}

const fmt = (n: number, d = 1): string =>
  Number.isFinite(n) ? n.toFixed(d) : '—';

export function LabReportView({
  report,
  hasParcel,
}: {
  report: LabReport | null;
  hasParcel: boolean;
}) {
  if (!report || !hasParcel) {
    return (
      <div className="lab-report" data-testid="lab-report-empty">
        Select a parcel to see the readout.
      </div>
    );
  }
  const { fov, distanceMm, report: rpt, labels, best } = report;
  return (
    <div className="lab-report" data-testid="lab-report">
      <div className="lab-metrics">
        <Row k="vFOV" v={`${fmt(fov.vFovDeg, 2)}°`} />
        <Row k="hFOV" v={`${fmt(fov.hFovDeg, 2)}°`} />
        <Row k="FOV @ target" v={`${fmt(fov.planeWidthMm, 0)} × ${fmt(fov.planeHeightMm, 0)} mm`} />
        <Row k="Distance" v={`${fmt(distanceMm, 0)} mm`} />
        <Row k="Report mm/px" v={fmt(rpt.mmPerPx, 4)} />
        <Row k="Report PPM @0°" v={fmt(rpt.ppmAt0Deg, 2)} />
        <Row
          k={`Report PPM @${rpt.worstIncidenceDeg}°`}
          v={`${fmt(rpt.ppmAtWorstDeg, 2)} (${rpt.ppmOk ? 'PASS' : 'FAIL'})`}
        />
      </div>

      <h4>Labels ({labels.length})</h4>
      <table className="lab-label-table" data-testid="lab-labels">
        <thead>
          <tr>
            <th>Face</th>
            <th>Angle°</th>
            <th>PPM</th>
            <th>Blur px</th>
            <th>Coverage %</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l) => (
            <tr key={l.labelInstanceId} className={best && l.labelInstanceId === best.labelInstanceId ? 'lab-best' : ''}>
              <td data-testid={`lab-face-${l.labelInstanceId}`}>{l.face}</td>
              <td>{fmt(l.incidenceDeg)}</td>
              <td>{fmt(l.pixelsPerModule, 2)}</td>
              <td>{fmt(l.blurPx, 2)}</td>
              <td>{fmt(l.coverage * 100, 1)}</td>
              <td>{fmt(l.confidence * 100, 0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {best && (
        <div data-testid="lab-reasons">
          <h4>Readability — {best.face} label</h4>
          {best.reasons.length === 0 ? (
            <span className="lab-read-ok">READABLE — all quality gates pass.</span>
          ) : (
            <ul>
              {best.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
