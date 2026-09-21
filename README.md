# Anfisa · Conveyor Barcode Station

An interactive Three.js demo of a synthetic belt-conveyor barcode reading
station. A stream of parcels travels a fixed belt past a six-camera rig:
four oblique area readers plus two encoder-synced **line scanners** on the
top and bottom faces. The app runs a **deterministic domain simulation +
capture/decode pipeline** and renders the station, live camera feeds,
per-parcel pipeline state, and run-level metrics.

Everything on screen is **synthetic ground truth**, not a real camera feed.
The purpose is to demo the station's measurement model and the fail-safe
pipeline behavior (association, quality gating, aggregation, no-read reasons)
in a form a reviewer can poke at. A real PoC is still required for optical
validation.

The final report's numerical parameters (reader geometry, sensor sizes,
sampling, working distances) are frozen in `src/report/reportSpec.ts` —
the single source of truth for the report-aligned preset. `Report Draft.md`
is a legacy draft and is not the design contract.

---

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173  (Vite; the run auto-starts on load)
```

Other commands:

```bash
npm test           # vitest unit + deterministic e2e suites (480 tests)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # typecheck + production bundle
npm run preview    # serve the production bundle
```

The dev server uses a hash router, so deep links look like
`http://localhost:5173/#/camera-lab`.

---

## Views

The top nav has five views. The domain run (config, seed, sim clock) is a
single shared store, so switching views does **not** reset the run — the same
parcels keep moving.

### Operations (default)

- Central 3D station: orbit the camera, watch parcels travel the belt.
  Click a parcel to select it (click empty space to clear; it otherwise
  auto-follows the newest parcel).
- Six-tile camera wall: live feed per camera with synchronized pipeline
  metadata (frame time, parcel IDs in frame, decoded labels, warnings).
- Side panel: pipeline timeline, the selected parcel's result card, and live
  run metrics.

### Camera Lab

One camera + one parcel frozen at an instant, with full rig editing:
position, look-target, focal length (vFOV is derived), sensor size, exposure,
gain, focus, shutter mode, illumination, noise/compression, aperture proxy,
and preview size. Every edit is validated before it commits and propagates
live to the pipeline (feed + PPM/incidence/quality update in place).

Controls include:

- **Freeze / Step 50 ms** — stop the run and advance one capture step at a
  time to inspect a single frame.
- **Preset** — apply a named config (resets the run).
- **Fault scenario buttons** — raise live fault conditions without a reset.
- **Export / Import** — download the config JSON, full run record JSON,
  observation audit log, and metrics CSV; import a config JSON.
- **Geometry vs pixel decoder** — synthetic experiment panel (issue #17):
  renders the frozen frame at full sensor resolution and decodes the bwip-js
  label textures from raw pixels with a selectable engine (custom TS
  line-scanner, or ZXing C++ via WebAssembly — lazy-loaded), compared
  label-by-label against the geometry verdicts.

### Schema

A labelled engineering drawing of the station: belt width, parcel dimensions,
camera working distances, FOV, incidence angles, the bottom opening, flow
direction, and sorter distance. This is the "explain the geometry in one
glance" view (AC-09).

### Metrics

Run-level metrics computed from the same inputs as the headless record:
read rate, no-read count, per-reason breakdown, association quality, and
capture-to-decode latency. These are **synthetic ground-truth regression
metrics**, not optical performance numbers.

### How It Works

The teaching view: an 11-stage process step rail (created → entry/tracking →
reader triggering → acquisition → preprocessing → quality gating → decode →
association → dedup/aggregation → exit/finalization → PLC ACK/sort) with
keyboard prev/next, a lightweight HTML/CSS flow diagram, and live evidence
cards that map a selected parcel's real event stream onto the stages
(complete / in progress / pending / failed, with counts and reasons).
The parcel selector follows the newest parcel by default. A callout reminds
reviewers that decode accuracy is **analytic** (geometric projection +
deterministic quality model), not a GPU image readout.

---

## Line-scan cameras (top/bottom)

Config v3 extends `CameraConfig` into a discriminated union
(`AREA_SCAN | LINE_SCAN`). The TOP and BOTTOM readers are line scanners:
a line sensor across the belt acquires one row per encoder step while a
parcel crosses the scan plane, so each parcel leaves a deterministic
(encoder, cross-belt) **strip** of rows — no 2D frames, no rolling shutter.

- **Encoder synchronization** — every line is stamped with the belt encoder
  position (`encoderStepMmPerLine`), so the strip is a known mm-space image
  of the parcel; travel-direction resolution comes from the encoder step,
  not the exposure.
- **Strip lifecycle** — a session opens when the parcel front crosses the
  scan plane and closes at the rear crossing (or aborts on camera fault,
  close spacing of a new parcel, or the max-strip bound). The closed strip
  is observed (shared quality gating, GAP occlusion for bottom transfer)
  and decoded analytically — decode consumes only the domain strip, never
  preview pixels.
- **Strip preview** — the camera wall shows a display-only reconstruction of
  the strip in encoder-mapped form (banding, mapping jitter, missing lines
  and motion smear from the rig's image effects are reproduced for
  realism). It is a teaching aid; it is provably not the decode input.
- **Association** — label observations associate to a parcel when the
  parcel's encoder interval overlaps the strip's encoder span (interval
  overlap, same as area frames' temporal association).

The default preset ("Report layout · 4 oblique + top/bottom") implements
the `Report Draft.md` geometry: four 9K area readers at 45° / 90° spacing,
top + bottom line scanners, and a 100 mm conveyor gap for the bottom view.

---

## Pixel decoder experiment (issue #17, stretch)

Camera Lab's *Geometry vs pixel decoder* panel decodes the app's own
rendered label textures from raw pixels — a synthetic experiment, off the
capture/decode hot path, stamped `processingMode: 'PIXEL_DECODER'` in every
result (the capture path is always `GEOMETRY_MODEL`). Two engines:

- **custom TS line-scanner** (`src/pipeline/pixelDecoder.ts`) — scans the
  candidate quad and matches the bwip-js symbol table. Note: bwip emits a
  legacy Code 128 with a position-weighted checksum that deviates from
  ISO 15417, so this decoder mirrors bwip's table to read the app's labels.
- **ZXing C++ (WebAssembly)** (`src/pipeline/zxingDecoder.ts`,
  [`zxing-wasm`](https://www.npmjs.com/package/zxing-wasm)) — the standard
  library reader, loaded lazily (`import('zxing-wasm/reader')`) so it never
  touches startup. The wasm binary (~1 MiB, reader subpath) is self-hosted
  at `public/zxing/zxing_reader.wasm` (browser) or instantiated from
  `node_modules` in tests — deterministic, no network.

Neither engine is a claim that real optics/noise handling works — see
Limitations.

---

## Config versions (v2 → v3)

`CONFIG_VERSION` is 3. Importing an older config JSON runs
`migrateConfigToLatest`: v2 rigs (which predate line scanners) are stamped
`kind: 'AREA_SCAN'` and the version is bumped; unsupported versions are
rejected with the original version reported. New configs can opt TOP/
BOTTOM rigs into `LINE_SCAN` with the line block (`sensorWidthMm`,
`pixelsPerLine`, `encoderStepMmPerLine`, `maxLineRateLinesPerSec`,
`lineExposureUs`, `scanPlaneZMm`, …).

---

## Five-minute walkthrough

1. Open **Schema** and explain the belt, parcel axes, six views, the
   side-grip bottom opening, and the sorter distance.
2. Switch to **Operations**. Select a parcel and follow its ID through
   photoeye entry, camera frames, observations, aggregation, and ACK.
3. Open the parcel result and point out multiple physical labels, including
   two instances that carry the same payload.
4. Open **Camera Lab** on a side camera. Move it or change the focal length
   and show the live change in FOV, working distance, incidence angle, PPM,
   and the feed.
5. Raise exposure or add glare until a label becomes unreadable. Show the
   explicit no-read reason and the metric change.
6. Switch the **Bottom gap transfer** preset to **Side-grip transfer** and
   show why the full bottom face becomes observable.
7. Trigger a **camera fault** and show the fail-safe parcel status (no
   fabricated successful read).
8. Finish on **Metrics**, state that the numbers are synthetic ground-truth
   regression metrics, and note that a real PoC is required for optical
   validation.

### Available presets (Camera Lab → Preset)

Report layout · 4 oblique + top/bottom (default), Recommended 6-view, Draft
4-oblique, Bottom gap transfer, Side-grip transfer, Glare stress,
Small-module stress, Camera failure, Close spacing.

---

## Performance budget (NFR-001)

Target: a 10-parcel run sustains **55–60 FPS** at presentation resolution
with helpers hidden, and the six camera previews refresh at 5–10 visible
updates/s (NFR-002).

How the budget is met:

- The domain sim is fixed-step (5 ms) and decoupled from the display. Only
  the display pump is coupled to `requestAnimationFrame`; the renderer renders
  at the display's natural rate.
- The GPU camera preview render is throttled to **8 Hz** per camera. Logical
  captures stay at the camera's 20 Hz cadence (the geometry decode is
  texture-free); non-due frames reuse the last rendered texture. This stops
  six full-scene renders from dominating the frame.
- Live metrics recompute at most every 250 ms of sim time.

Verification:

- **Headless (in CI):** `npm test` includes a frame-budget test
  (`src/store/frameBudget.test.ts`) that drives the 10-parcel scenario at a
  simulated 60 Hz and asserts the per-tick CPU cost stays far inside the
  16.7 ms frame budget (average < 2 ms, p99 < 10 ms). This guards the
  pipeline/sim CPU work that would otherwise eat the frame.
- **Browser (manual):** `npm run dev`, watch Operations with ~10 parcels in
  flight. On a GPU-equipped browser the main view sustains 55–60 FPS. Under a
  software rasterizer (headless/CI) the frame rate is lower and occasional
  single-render stalls occur; that is a rendering-context limitation, not the
  pipeline.

---

## Determinism

Identical config + seed produces byte-for-byte equivalent domain records at
**any** display refresh rate (AC-08). There are no wall-clock UI timestamps in
the run record — every time is sim time. `src/store/determinism.test.ts`
drives the live store at 60 Hz, 10 Hz, and step granularity and asserts the
records match a headless reference run exactly.

---

## Limitations

- All imagery is synthetic; the pipeline demonstrates measurement-model and
  fail-safe behavior, not real optical accuracy.
- The browser FPS number depends on the GPU. The CI test covers the CPU side
  of the budget only.
- Camera Lab freezes the run while a single frame is being inspected; resume
  to continue the live run.
