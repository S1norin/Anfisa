# Final Report Alignment Plan

## Objective

Make the Anfisa project faithfully represent the final LaTeX report for the
conveyor barcode-reading station.

The final report is the source of truth. The repository's `Report Draft.md`
describes an older four-side-camera design and must not be used as the design
contract for the final report preset.

The finished application should remain explicit about its validation level:

- physical geometry and sampling calculations are modelled;
- synthetic imagery and deterministic tests are demonstrations, not optical
  proof;
- any analytic decoder and any real pixel decoder are reported as separate
  processing modes;
- real-world read-rate claims require a physical proof of concept.

## Current gap summary

| Area | Final report | Current project | Required action |
|---|---|---|---|
| Reader count | 6 side area cameras + top/bottom line scanners | 4 side area cameras + top/bottom line scanners | Add a true 8-reader report preset |
| Side directions | 60° intervals, worst case about 30° | 90° intervals, worst case about 45° | Replace report-preset poses and angle assumptions |
| Barcode module | 0.35 mm | 0.4 mm in the report preset | Use 0.35 mm throughout the report path |
| Side sensor | About 8000×4500 px | 9000×6000 px | Align config and displayed calculations |
| Side optics | WD 1400–1500 mm, lens about 50–60 mm | Radius 1250 mm, 37 mm lens | Align pose, sensor size, and focal length |
| Side acquisition | 20–30 FPS, 50–100 µs, global shutter | 25 FPS, 15 µs, global shutter | Use the report operating range and verify blur |
| Line FOV | 715 mm across the belt | Model uses 512 mm as `sensorWidthMm` | Separate physical sensor size from object-space FOV |
| Line sampling | 8192 px, at least 8.5 kHz; target 10 kHz | 8192 px, 0.1 mm step, 12 kHz ceiling | Retain valid values but correct their meaning and formulas |
| Line PPM | Derived from 0.35 mm module | Observation uses a hard-coded normalized 1 mm module | Use configured module size |
| Centering | Upstream guide/centering mechanism | Parcels default to zero offset; no explicit mechanism | Model and render guides; add offset stress tests |
| Decode algorithm | ROI, optional perspective correction, ZXing C++ multi-code | Primary pipeline is analytic; custom TS decoder is lab-only | Add an honest real-pixel mode or revise the represented algorithm |
| Duplicate Rate | Redundant reads divided by pre-dedup results | Absolute collapsed-observation count | Add the ratio while retaining audit counts |

## Design decisions to settle first

### 1. Report preset identity

Create a new stable preset ID such as `report-8-reader`. Keep the existing
`report-6view` preset as a clearly named legacy preset or migrate it through a
versioned alias. Do not silently change saved configurations that reference the
old preset semantics.

### 2. Camera placement convention

The final report says that six side cameras are mounted three per conveyor
side and that adjacent viewing directions differ by about 60°. Before coding,
record exact world coordinates and look targets in one diagram/table. Tests
must verify:

- three cameras have positive lateral positions and three negative;
- adjacent optical directions differ by 60° within tolerance;
- every vertical face has a nearest valid view at no more than 30° under the
  report's centred-parcel assumption;
- camera bodies do not occupy the belt or parcel envelope.

### 3. Line-scan terminology

The existing `sensorWidthMm` field is used as object-space coverage even though
its name and comments imply physical sensor length. Split it into unambiguous
fields:

- `physicalSensorWidthMm` — approximately 40.96 mm for an 8192×5 µm sensor;
- `fovWidthMm` — 715 mm at the scan plane;
- `pixelsPerLine` — 8192;
- `encoderStepMmPerLine` — no more than 0.117 mm, with 0.1 mm as the preset;
- `maxLineRateLinesPerSec` — at least 10,000, with 12,000 as the preset.

This is a config schema change and should increment the config version with an
explicit migration from v3.

### 4. Decoder claim

Use two clearly named modes:

- `GEOMETRY_MODEL`: deterministic analytic quality/decode demonstration;
- `PIXEL_DECODER`: decode actual rendered pixels.

For strict report parity, perform a short dependency spike for ZXing C++ via
WebAssembly. The spike must prove Code 128, multiple symbols per image, browser
bundle compatibility, deterministic test fixtures, and acceptable bundle size.
If the spike fails, keep the analytic/custom decoder but change UI and docs so
they do not claim that ZXing C++ is implemented.

## Implementation phases

### Phase 0 — Freeze the report contract

- Add a repository copy of the final report or a concise checked-in parameter
  specification derived from it.
- Mark `Report Draft.md` as legacy.
- Add `src/report/reportSpec.ts` containing named values and units, without UI
  or simulation logic.
- Add unit tests for the report's calculations: module size, maximum mm/px,
  715 mm line FOV, minimum pixels per line, line rate, exposure ceiling, side
  diagonal/FOV, side resolution, and focal-length examples.

Acceptance:

- Each numerical value shown in the UI can be traced to the report spec or a
  labelled engineering assumption.
- No final-report test imports values from the legacy draft preset.

### Phase 1 — Config v4 and report-aligned reader model

- Increment `CONFIG_VERSION`.
- Split line physical-sensor width from scan-plane FOV.
- Add or clarify reader mount/direction metadata so six side directions do not
  misuse face roles.
- Implement v3-to-v4 migration.
- Create `reportEightReaderConfig()` and expose it as the default report preset.
- Preserve the old four-oblique layout under a legacy/draft preset.

Primary files:

- `src/domain/config.ts`
- `src/domain/types.ts`
- `src/domain/camera.ts`
- `src/capture/presets.ts`
- `src/presets/presets.ts`
- `src/store/import.ts`

Acceptance:

- The report preset validates and JSON-round-trips.
- It contains exactly six enabled area cameras and two enabled line scanners.
- Its values match the final report rather than `Report Draft.md`.
- Imported v3 configurations migrate deterministically without changing their
  legacy geometry.

### Phase 2 — Correct optical and line-scan calculations

- Calculate side FOV from physical sensor width, focal length, and working
  distance using one shared pinhole implementation.
- Validate 8000×4500 resolution against the report's projected module size and
  incidence angle.
- Pass `barcode.xDimensionMm` into line-strip observation; remove the hard-coded
  1 mm normalization.
- Calculate cross-belt line PPM from `fovWidthMm / pixelsPerLine`.
- Calculate travel PPM from `xDimensionMm / encoderStepMmPerLine`.
- Use the lower of the two as effective line PPM.
- Reject or reduce coverage when the line FOV does not cover the configured
  belt plus report margin.
- Verify line-rate saturation against belt speed.
- Recalculate blur using the correct object-space pixel pitch.

Primary files:

- `src/capture/lineScanGeometry.ts`
- `src/observation/lineScanObservation.ts`
- `src/observation/projection.ts`
- `src/observation/blur.ts`
- `src/ui/lab/labReport.ts`

Acceptance:

- At 1 m/s the report line preset requires 10,000 lines/s and remains below its
  12,000 lines/s limit.
- At 1.5 m/s it fails with a deterministic under-sampling reason.
- Changing the configured module width changes both area and line PPM.
- A line FOV narrower than the belt is reported as incomplete/out of FOV.

### Phase 3 — Station geometry and presentation

- Render six side-reader mounts, two line scanners, their axes, frusta/scan
  planes, and working distances.
- Make camera/reader walls responsive to eight readers rather than assuming six
  tiles.
- Add visible upstream centering guides and model their allowed lateral range.
- Keep the 100 mm bottom optical gap and controlled-light enclosure.
- Update the Schema view with the 60° spacing, 30° worst-case angle, 715 mm
  line FOV, and top/bottom working distances.
- Ensure selection, Camera Lab editing, fault injection, and export work for all
  eight readers.

Primary files:

- `src/scene/stationGeometry.ts`
- `src/scene/cameraRig.tsx`
- `src/scene/schemaData.ts`
- `src/scene/schemaScene.tsx`
- `src/ui/cameraWall.tsx`
- `src/styles/global.css`

Acceptance:

- All eight readers are individually visible, selectable, editable, and
  faultable.
- The camera wall has no clipping at the presentation viewport.
- Schema annotations agree with exported configuration values.

### Phase 4 — Processing-path parity

- Keep entry/exit photoeye ParcelID lifecycle and encoder association.
- Add an explicit static mask/ROI stage rather than only storing optional ROI
  metadata.
- For pixel mode, crop candidate barcode quadrilaterals and rectify perspective
  only for those candidates.
- Integrate the selected ZXing C++/WASM decoder if the spike passes.
- Support multiple Code 128 results from one image.
- Preserve instance-level aggregation so repeated payload values on distinct
  physical labels are not incorrectly removed.
- Ensure pixel mode never receives hidden ground-truth payloads.

Primary files:

- `src/pipeline/pixelDecoder.ts`
- `src/pipeline/decoder.ts`
- `src/pipeline/pipeline.ts`
- `src/pipeline/aggregation.ts`
- `src/capture/captureRenderer.tsx`

Acceptance:

- Pixel-mode success is derived from pixels, not the geometry quality flag or
  ground-truth payload.
- A fixture containing multiple Code 128 labels returns all valid payloads.
- Perspective and ROI tests cover rotated and partially clipped candidates.
- Geometry and pixel modes are labelled separately in run records and UI.

### Phase 5 — Report metrics

- Retain Complete Read Rate, Barcode Recall, Precision, and latency summaries.
- Add `duplicateRate = redundant observations / observations before dedup`.
- Keep absolute observation and collapsed-observation counts for auditability.
- Display entry-to-result and exit-to-result latency separately.
- Export every report metric to CSV and the immutable run record.

Primary files:

- `src/metrics/metrics.ts`
- `src/metrics/latency.ts`
- `src/export/csv.ts`
- `src/ui/liveMetrics.tsx`
- `src/ui/views/metricsView.tsx`

Acceptance:

- Metric denominators are documented and tested for empty, partial, duplicate,
  false-decode, and repeated-payload cases.
- UI, CSV, and JSON values come from the same `RunMetrics` object.

### Phase 6 — Verification and documentation

- Add a final-report acceptance suite that checks the exact eight-reader
  geometry and calculated requirements.
- Add deterministic runs for centred, lateral-offset, yawed, glare, damaged
  label, camera-fault, close-spacing, and speed-change scenarios.
- Measure the eight-reader rendering workload in a real GPU browser; do not
  infer browser FPS from headless CPU tests.
- Update README, How It Works, Camera Lab descriptions, preset names, and
  walkthrough text.
- State prominently that synthetic regression metrics are not measured optical
  performance.

Required verification commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Manual verification:

1. Open Schema and verify all report dimensions and eight readers.
2. Run the default report preset and inspect every reader feed.
3. Confirm side labels receive a nearest view at no more than 30°.
4. Confirm top/bottom strips show 715 mm FOV and encoder-derived rows.
5. Change speed to 1.5 m/s and verify line-rate failure is explained.
6. Apply lateral offset and verify the centering/FOV failure mode.
7. Export config, run JSON, observations, and metrics CSV and cross-check them.

## Test additions

- `reportSpec.test.ts`: every calculation in the report.
- `reportEightReaderPreset.test.ts`: exact reader count, positions, angles,
  intrinsics, acquisition, and gap.
- Config migration tests for v3 to v4.
- Line PPM tests using 0.35 mm, 715 mm, 8192 px, and 0.1 mm/line.
- Side worst-case PPM tests at 30°.
- Eight-reader camera-wall and Schema render tests.
- Pixel decoder multi-barcode and perspective fixtures.
- Duplicate Rate numerator/denominator tests.
- End-to-end tests proving observations associate with the correct ParcelID.

## Risks and mitigations

### Eight preview renders may miss the current FPS target

Mitigate with visibility-aware preview scheduling, shared render targets,
lower preview resolution, and staggered 5–10 Hz preview updates. Measure in a
real browser before changing the stated target.

### ZXing C++/WASM may materially increase bundle size

Keep it behind a lazy-loaded pixel-decoder mode. Record bundle-size and startup
impact during the spike. Do not remove the deterministic geometry model; it is
still useful for regression and explanation.

### Report geometry may be under-specified in world coordinates

Freeze an explicit coordinate table and diagram before implementation. Treat
that table as a labelled engineering interpretation, not as text implicitly
invented inside the preset builder.

### Existing saved configs use v3 semantics

Use a versioned migration and retain the legacy preset. Never reinterpret
`sensorWidthMm: 512` as a 512 mm physical sensor during migration.

## Definition of done

The alignment is complete when:

- the default report preset contains six side area cameras and two line
  scanners;
- all report dimensions and sampling calculations are represented by tested
  config values;
- side-camera worst-case incidence is about 30°, not 45°;
- line-scan PPM uses the configured 0.35 mm module and 715 mm FOV;
- the UI, Schema, exports, and documentation consistently describe eight
  readers;
- report metrics, including Duplicate Rate and both latency definitions, are
  present and tested;
- decoder modes accurately state whether results come from geometry or pixels;
- all automated checks pass and the eight-reader UI is manually verified in a
  GPU browser;
- the README explicitly states that a real optical PoC is still required.

