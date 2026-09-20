/**
 * How-It-Works guide model (t11): the 11 tutorial stages in doc order —
 * created → entry/tracking → reader triggering → acquisition →
 * preprocessing → quality gating → decode → association →
 * dedup/aggregation → exit/finalization → PLC ACK/sort.
 *
 * PURE data module: no React, no Three, no clock/random. The view layer
 * renders this; processEvidence (sibling module) supplies the live
 * per-stage evidence.
 */

export const PROCESS_GROUPS = [
  'Physical flow',
  'Acquisition',
  'Preprocessing',
  'Decode',
  'Postprocessing',
  'Output',
] as const;

export type ProcessGroup = (typeof PROCESS_GROUPS)[number];

export interface ProcessStage {
  /** Stable kebab-case id (key for evidence + UI). */
  id: string;
  title: string;
  group: ProcessGroup;
  body: string;
}

export const PROCESS_GUIDE: readonly ProcessStage[] = [
  {
    id: 'created',
    title: 'Created',
    group: 'Physical flow',
    body: 'A parcel is spawned on the upstream conveyor with its true spec: size, material, tape, and the label instances printed on its faces. Ground truth is known here and only here — the decoder never sees it.',
  },
  {
    id: 'entry-tracking',
    title: 'Entry & tracking',
    group: 'Physical flow',
    body: 'The parcel enters the station and the simulator tracks it: belt position from the encoder, phase (entered → exited), and the per-parcel timeline used by association windows.',
  },
  {
    id: 'reader-triggering',
    title: 'Reader triggering',
    group: 'Acquisition',
    body: 'Readers notice the parcel: area cameras schedule a capture when it is inside their trigger zone, and line scanners open a scan session when its front edge crosses the scan plane.',
  },
  {
    id: 'acquisition',
    title: 'Acquisition',
    group: 'Acquisition',
    body: 'Data is captured: one area frame per camera per trigger, or one encoder-synced line per encoder step until the strip closes at the parcel’s rear edge. Aborted strips (fault, close spacing, max length) carry a bounded reason event.',
  },
  {
    id: 'preprocessing',
    title: 'Preprocessing',
    group: 'Preprocessing',
    body: 'Each frame/strip passes the image-formation model: perspective projection, motion blur from belt speed × exposure, contrast and glare proxies. Display-only preview textures are built here — decode never reads them.',
  },
  {
    id: 'quality-gating',
    title: 'Quality gating',
    group: 'Decode',
    body: 'The shared quality model scores every observation (coverage, ppm, incidence, blur, contrast, glare) against the config thresholds and applies hard gates. Line strips extend the same model with strip-completeness and line-rate gates.',
  },
  {
    id: 'decode',
    title: 'Decode',
    group: 'Decode',
    body: 'Quality-passing observations are decoded: the geometry model reconstructs the label payload (pixel decoding is the alternate mode). A seeded boundary roll makes marginal reads fail deterministically.',
  },
  {
    id: 'association',
    title: 'Association',
    group: 'Postprocessing',
    body: 'Decoded payloads are associated to label instances on the right parcel: area reads use position + time windows, line strips use encoder-interval overlap. Zero or multiple overlapping parcels are reported as mismatches, never guessed.',
  },
  {
    id: 'dedup-aggregation',
    title: 'Dedup & aggregation',
    group: 'Postprocessing',
    body: 'Repeated reads of the same label instance across cameras and frames are deduplicated; per-parcel aggregates track expected vs decoded labels, best confidence, and the reason history.',
  },
  {
    id: 'exit-finalization',
    title: 'Exit & finalization',
    group: 'Output',
    body: 'The parcel exits the station and its result is finalized: OK, PARTIAL, NO_READ, AMBIGUOUS, or SENSOR_FAULT — the verdict the audit record and metrics consume.',
  },
  {
    id: 'plc-ack-sort',
    title: 'PLC ACK & sort',
    group: 'Output',
    body: 'The downstream PLC acknowledges the result after the configured latency, and the parcel is sorted. Only acked parcels count as fully processed in the run metrics.',
  },
];
