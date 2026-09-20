# Anfisa · Conveyor Barcode Station

An interactive Three.js demo of a synthetic belt-conveyor barcode reading
station. A stream of parcels travels a fixed belt past a six-camera rig. The
app runs a **deterministic domain simulation + capture/decode pipeline** and
renders the station, live camera feeds, per-parcel pipeline state, and
run-level metrics.

Everything on screen is **synthetic ground truth**, not a real camera feed.
The purpose is to demo the station's measurement model and the fail-safe
pipeline behavior (association, quality gating, aggregation, no-read reasons)
in a form a reviewer can poke at. A real PoC is still required for optical
validation.

---

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173  (Vite; the run auto-starts on load)
```

Other commands:

```bash
npm test           # vitest unit + deterministic e2e suites (357 tests)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # typecheck + production bundle
npm run preview    # serve the production bundle
```

The dev server uses a hash router, so deep links look like
`http://localhost:5173/#/camera-lab`.

---

## Views

The top nav has four views. The domain run (config, seed, sim clock) is a
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

Recommended 6-view, Draft 4-oblique, Bottom gap transfer, Side-grip transfer,
Glare stress, Small-module stress, Camera failure, Close spacing.

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
