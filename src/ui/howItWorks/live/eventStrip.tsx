/**
 * Live event strip (t7-3): the per-capture pipeline as a compact
 * horizontal strip —
 *
 *   capture → preprocessing → candidate → decode → parcel association → final result
 *
 * Every node derives from the SAME newest result of the selected camera
 * (one captureId across the whole strip). Failed reads show their
 * explicit no-read reason — the strip never invents a value.
 */

import type { LiveProcessingResult } from '../../../live-processing/contracts';
import type { LiveCropDecode } from './liveDecode';

export type LiveEventState = 'done' | 'failed' | 'running' | 'idle';

export interface LiveEventNode {
  name: 'capture' | 'preprocessing' | 'candidate' | 'decode' | 'association' | 'final';
  state: LiveEventState;
  detail: string;
}

/** Derive the six strip nodes from one result + its browser decode. */
export function deriveLiveEvents(
  result: LiveProcessingResult | null,
  cropDecode: LiveCropDecode | null,
  parcelId: string,
): LiveEventNode[] {
  if (!result) {
    return [
      { name: 'capture', state: 'idle', detail: 'awaiting capture' },
      { name: 'preprocessing', state: 'idle', detail: '—' },
      { name: 'candidate', state: 'idle', detail: '—' },
      { name: 'decode', state: 'idle', detail: '—' },
      { name: 'association', state: 'idle', detail: '—' },
      { name: 'final', state: 'idle', detail: '—' },
    ];
  }
  const noReadReason = result.decode.decoded
    ? []
    : (result.decode.reasons.length > 0 ? result.decode.reasons : ['NO_READ']);
  const decodeState: LiveEventState = cropDecode
    ? cropDecode.decoded
      ? 'done'
      : 'failed'
    : result.decode.pending
      ? 'running'
      : noReadReason.length > 0
        ? 'failed'
        : 'done';
  const decodeDetail = cropDecode
    ? cropDecode.decoded
      ? cropDecode.payload ?? ''
      : cropDecode.reasons.join(' ')
    : result.decode.pending
      ? 'decoding…'
      : decodeState === 'failed'
        ? noReadReason.join(' ')
        : '';
  const associated = cropDecode?.decoded === true;
  return [
    { name: 'capture', state: 'done', detail: result.captureId },
    {
      name: 'preprocessing',
      state: result.stages.length > 0 ? 'done' : 'failed',
      detail:
        result.stages.length > 0
          ? `${result.stages.length} stages · ${Math.round(result.processingMs)} ms`
          : 'no stages returned',
    },
    {
      name: 'candidate',
      state: result.candidate ? 'done' : 'idle',
      detail: result.candidate ? 'candidate found' : 'no candidate',
    },
    { name: 'decode', state: decodeState, detail: decodeDetail },
    {
      name: 'association',
      state: associated ? 'done' : 'idle',
      detail: associated ? `→ ${parcelId}` : 'no read to associate',
    },
    {
      name: 'final',
      state: associated ? 'done' : decodeState === 'failed' ? 'failed' : 'idle',
      detail: associated
        ? (cropDecode?.payload ?? '')
        : decodeState === 'failed'
          ? noReadReason.join(' ')
          : '—',
    },
  ];
}

/** The compact horizontal strip. */
export function LiveEventStrip({
  result,
  cropDecode,
  parcelId,
}: {
  result: LiveProcessingResult | null;
  cropDecode: LiveCropDecode | null;
  parcelId: string;
}) {
  const nodes = deriveLiveEvents(result, cropDecode, parcelId);
  return (
    <ol
      className="hiw-live-events"
      aria-label="Live processing events"
      data-testid="live-event-strip"
    >
      {nodes.map((n) => (
        <li
          key={n.name}
          className={`hiw-live-event hiw-live-event--${n.state}`}
          data-testid={`live-event-${n.name}`}
          data-state={n.state}
        >
          <span className="hiw-live-event-name">{n.name}</span>
          <span className="hiw-live-event-detail" data-testid={`live-event-${n.name}-detail`}>
            {n.detail}
          </span>
        </li>
      ))}
    </ol>
  );
}
