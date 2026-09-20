# How It Works Tab and Line-Scanner Migration Plan

## Status

Planning document only. This document does not describe completed functionality.

## Goals

1. Add a fifth **How It Works** tab that explains the physical conveyor flow and software pipeline step by step.
2. Replace the default TOP and BOTTOM area-scan cameras with true encoder-synchronized line scanners.
3. Keep the four oblique side readers as area-scan cameras.
4. Reuse the existing deterministic simulation, observation, association, aggregation, finalization, metrics, and audit infrastructure.
5. Keep the explanation readable and avoid the annotation density of the engineering Schema view.

## Proposed Default Station

- FRONT, REAR, LEFT, and RIGHT: oblique area-scan cameras.
- TOP: downward-looking line scanner with a cross-belt scan line.
- BOTTOM: upward-looking line scanner aligned with the conveyor transfer gap.
- Top and bottom scanners have narrow line lights aligned to their scan planes.
- The bottom scanner can only observe the parcel through a valid gap or side-grip transfer opening.

The two acquisition paths merge before association and aggregation:

```text
Side area cameras: frame capture -> observation measurements --+
                                                            |
Top/bottom line scanners: encoder lines -> strip -> measures +
                                                            |
                                                            v
association -> deduplication -> aggregation -> finalization -> PLC ACK
```

---

## Part 1: How It Works Tab

### Route and Navigation

- Route: `#/how-it-works`
- Navigation label: **How It Works**
- Position it directly after **Operations**.
- Opening or leaving the tab must not pause, reset, or otherwise mutate the shared simulation.

Expected integration points:

- `src/App.tsx`
- `src/app/layout.tsx`
- `src/styles/global.css`
- `README.md`

### Page Structure

The page should have three primary areas:

1. **Step rail**
   - Groups steps into Physical flow, Acquisition, Preprocessing, Decode, Postprocessing, and Output.
   - Shows pending, active, complete, and failed states for the selected parcel.
   - Uses real buttons and `aria-current="step"`.

2. **Focused process diagram**
   - Use a lightweight HTML/CSS/SVG diagram rather than another dense Three.js scene.
   - Highlight only the hardware and data involved in the selected step.
   - Show area-scan and line-scan acquisition as separate branches that later merge.

3. **Explanation and live evidence**
   - Explain what enters the step, what happens, what comes out, and how it can fail.
   - Show real values from the selected live or finalized parcel.
   - Put secondary measurements behind a **Technical details** disclosure.

### Controls

- Previous and Next step.
- Direct selection from the step rail.
- Parcel selector.
- **Follow newest parcel**, enabled by default.
- Optional **Follow live progress**, which selects the latest reached stage.
- Running/paused simulation indicator.
- Left/Right keyboard navigation between steps.

### Tutorial Stages

| Step | Section | Explanation | Live evidence |
| --- | --- | --- | --- |
| 1. Package created | Input | The seeded generator creates parcel dimensions, material, position, tape state, parcel ID, physical label-instance IDs, payloads, faces, rotations, and damage. IDs exist before station entry. | Parcel ID, dimensions, material, label IDs, payloads, and faces |
| 2. Entry and tracking | Physical flow | The package crosses the logical entry photoeye. Entry time and encoder position are recorded, and subsequent movement follows encoder displacement. | Entry event, encoder, speed, parcel phase |
| 3. Reader triggering | Acquisition | Area cameras arm when a parcel projects into their sensor. Line scanners open a scan session when the parcel front crosses the scan plane. | Reader states, candidate IDs or scan-session assignment |
| 4. Image/strip acquisition | Acquisition | Area readers expose 2D frames. Line scanners accumulate cross-belt lines using encoder travel and reconstruct a strip when the rear edge clears the plane. | Frame time or strip progress, line count, encoder range |
| 5. Observation preprocessing | Preprocessing | The model calculates coverage, distance, occlusion, sample density, incidence, motion smear, focus, contrast, glare, damage, and other explainable measurements. | Measurements for the selected reader and label |
| 6. Quality gating | Preprocessing | Normalized components form a quality score. Hard gates reject impossible conditions; marginal observations use a deterministic seeded boundary decision. | Confidence, pass/fail, gate failures, reason codes |
| 7. Barcode decode | Decode | A passing observation returns a payload and confidence. A failed observation produces no successful decode. | Payload or explicit no-read reasons |
| 8. Parcel association | Postprocessing | The observation must belong to a known parcel and label instance and pass encoder-position/time or scan-interval validation. | Association result and mismatch reason |
| 9. Deduplication and aggregation | Postprocessing | Repeated observations of one physical label collapse across frames/readers. Separate labels with the same payload remain separate. | Observation count, readers, best confidence, decoded count |
| 10. Exit and finalization | Output | After exit plus the grace period, the parcel receives `OK`, `PARTIAL`, `NO_READ`, `SENSOR_FAULT`, or `AMBIGUOUS`. | Expected/decoded labels, final status, latency |
| 11. PLC ACK and sorting | Output | The result receives a simulated PLC ACK. The parcel continues to the sort point and is retired after fully clearing it. | ACK time, sort event, final audit record |

### Accuracy Callout

The tab must distinguish analytic decoding from visible preview rendering:

```text
Visible area-camera preview:
Three.js scene -> visual artifact shader -> feed tile

Area-camera decode model:
geometry -> analytic measurements -> quality gate -> synthetic decode

Line-scanner preview:
synthetic face/label source -> encoder reconstruction -> display strip

Line-scanner decode model:
scan geometry -> two-axis sampling -> quality gate -> synthetic decode
```

The application does not decode pixels from the visible GPU preview. The explanation must not imply that it runs a production OpenCV or proprietary barcode-decoder pipeline.

### Presentation Model

Add a pure, testable adapter instead of putting derivation logic in React:

```text
src/ui/process/processGuide.ts
src/ui/process/processEvidence.ts
src/ui/process/processDiagram.tsx
src/ui/process/processStepRail.tsx
src/ui/process/processEvidenceCard.tsx
src/ui/views/howItWorksView.tsx
```

`processGuide.ts` should contain static stage definitions and explanatory copy.

`processEvidence.ts` should derive each stage's status and evidence from:

- simulation events;
- line-scan events;
- pipeline events;
- live observations;
- parcel aggregate;
- final result.

It should return `pending`, `active`, `complete`, or `failed` without importing React or Three.js.

The existing Operations timeline can supply some timestamps, but it should remain stable. The richer explainer model needs acquisition-mode branches, quality, association, exit, and sort stages that the current timeline does not expose.

### Visual and Accessibility Rules

- Show one emphasized step at a time.
- Dim unrelated cameras, lights, and processing nodes.
- Use distinct colors for physical motion, acquisition, processing, success, and failure.
- Do not rely on color alone; always include labels or icons.
- Limit the primary evidence card to approximately four measurements.
- Use plain-language titles with technical terminology underneath.
- On narrow screens, use step rail -> diagram -> explanation order.
- Respect `prefers-reduced-motion`.
- The view must render and remain useful without WebGL.

---

## Part 2: TOP and BOTTOM Line Scanners

### Acquisition Principle

A line scanner captures one cross-belt sensor row at a specific encoder position. Conveyor travel supplies the second image dimension:

```text
1D sensor line across X
        +
successive encoder positions along Z
        =
reconstructed 2D parcel strip
```

For each parcel:

1. The front edge reaches the scanner's fixed Z scan plane.
2. A scan session is assigned to the scanner and parcel.
3. Encoder travel accumulates lines while the parcel passes.
4. The rear edge clears the scan plane.
5. The completed strip produces label observations.
6. Observations enter the shared decode, association, aggregation, and finalization pipeline.

### Physical Layout

#### TOP scanner

- Mount above the parcel and look vertically down.
- Run the sensor line across the belt's X axis.
- Use conveyor movement along Z to reconstruct strip height.
- Align a narrow top line light to the scan plane.
- Preserve configurable pose, working distance, focus, exposure, gain, and polarization.

#### BOTTOM scanner

- Mount below the conveyor and look vertically up.
- Place the scan plane at the centre of the transfer gap.
- Add bottom line lighting inside or immediately beside the gap.
- Keep bottom labels occluded when a solid deck blocks the view.
- Allow bottom acquisition only for compatible gap or side-grip geometry.

### Configuration Model

Replace the current universal area-camera assumption with a discriminated type:

```ts
type CameraConfig = AreaScanCameraConfig | LineScanCameraConfig;
```

Shared fields:

- ID, name, and role;
- pose;
- optics and focus;
- exposure and gain;
- illumination;
- preview configuration;
- enabled/fault state.

Area-scan fields:

- sensor width and height;
- focal length and physical sensor size;
- FPS;
- global/rolling shutter;
- ROI.

Line-scan fields:

- pixels per line;
- physical sensor width;
- encoder step in millimetres per line;
- maximum line rate;
- maximum reconstructed strip length;
- scan direction and scan-plane position;
- line exposure;
- optional encoder jitter, missing-line, and banding parameters.

Initial simulation assumptions should remain configurable and clearly labelled. A reasonable starting point is an 8K line, a 0.1-0.2 mm encoder step, short global line exposure, and a reconstructed height derived from parcel travel rather than a fixed sensor height.

### Config Migration

- Increment the config version.
- Migrate existing imported camera definitions to `AREA_SCAN`.
- Convert only TOP and BOTTOM readers in the new default/report presets to `LINE_SCAN`.
- Keep old saved configurations usable.
- Export only the new normalized format.
- Validate type-specific fields and reject invalid hybrid configurations.

Primary files:

- `src/domain/types.ts`
- `src/domain/config.ts`
- `src/domain/camera.ts`
- `src/store/import.ts`
- `src/capture/presets.ts`
- `src/presets/presets.ts`

### Encoder-Synchronized Sessions

Add a `LineScanSession` with:

- scanner ID;
- parcel ID;
- start time and encoder position;
- current/end encoder position;
- accumulated line count;
- scan-plane position;
- status: active, completed, or aborted;
- interruption/fault information.

Session rules:

- Start when the parcel front crosses the scan plane.
- Compute new lines from encoder displacement, not display time.
- Complete when the parcel rear crosses the plane.
- Abort or mark incomplete if the scanner faults during acquisition.
- Handle multiple closely spaced parcels without reassigning lines to the wrong package.

Do not append one event per line. Accumulate internally and emit bounded summary events:

- `LINE_SCAN_STARTED`
- `LINE_SCAN_COMPLETED`
- `LINE_SCAN_ABORTED`

A completion event should include scanner ID, parcel ID, encoder start/end, line count, expected line count, and completion status.

### Required Line Rate

```text
required line rate = belt speed / encoder step
```

Example: 1,000 mm/s at 0.2 mm/line requires 5,000 lines/s.

The model must correctly handle:

- belt-speed changes during a session;
- pausing and resuming;
- maximum line-rate saturation;
- missing encoder samples;
- close parcel spacing;
- camera faults during a strip.

If required line rate exceeds scanner capacity, along-travel sampling must degrade. It should surface through a reason such as `LOW_PPM` instead of silently producing a perfect strip.

### Observation Model

Create a dedicated line-scan observation module rather than forcing line acquisition through the existing 2D-frame projection:

```text
src/observation/lineScanObservation.ts
```

For each TOP or BOTTOM label, calculate:

- whether the correct face crosses the scan plane;
- cross-belt coverage;
- cross-belt pixels per module;
- along-travel lines per module;
- label rotation relative to the sensor and travel axes;
- working distance and focus;
- incidence angle;
- exposure smear;
- contrast, glare, and damage;
- bottom-deck occlusion;
- missing or incomplete line coverage.

Use the weaker sampling axis for the effective quality input:

```text
effective PPM = min(cross-belt pixels/module, travel lines/module)
```

Existing quality scoring, reason ordering, decoding, aggregation, and finalization should remain shared.

### Association

Area observations continue using point-in-time frame metadata. Line-strip observations should validate an encoder interval:

```text
scanner + scan-plane crossing + encoder interval -> parcel scan session
```

Validate that:

- the parcel exists;
- the label instance belongs to it;
- the parcel's encoder interval overlaps the scan interval;
- the strip is fresh;
- no overlapping session creates an ambiguous assignment.

Association mismatches must remain explicit and flow into the existing `AMBIGUOUS` status policy.

### State and Event Processing

The current area-camera state cycle remains:

```text
IDLE -> ARMED -> CAPTURING -> PROCESSING -> IDLE
```

For a line scanner:

- `ARMED`: a parcel is approaching the scan plane;
- `CAPTURING`: at least one scan session is accumulating lines;
- `PROCESSING`: a strip has completed and is being evaluated;
- `FAULT`: active strips are aborted or marked incomplete.

The scheduler should dispatch by acquisition type while preserving deterministic fixed-step processing.

Expected files:

- `src/capture/scheduler.ts`
- new `src/capture/lineScanner.ts`
- `src/simulation/state.ts`
- `src/simulation/sim.ts`
- `src/store/simStore.ts`
- `src/pipeline/feedCapture.ts`
- `src/domain/events.ts`

### Preview Reconstruction

A line scanner does not have a normal 2D perspective view. Do not render thousands of individual Three.js scan rows.

Instead:

1. Build a synthetic top/bottom parcel-face source texture.
2. Map encoder displacement to the reconstructed strip's vertical axis.
3. Apply line-specific artifacts such as banding, exposure smear, missing lines, and encoder stretch.
4. Downsample only the displayed preview; retain analytic sampling metadata for quality decisions.

The line-strip preview remains presentation-only. Decode decisions come from the analytic line-scan observation model.

The capture buffer should use an acquisition union that can represent either an area frame or a reconstructed strip, including strip progress and encoder metadata.

### Camera Lab

Area-camera controls remain unchanged. When a line scanner is selected, show:

- pixels per line;
- encoder step;
- required/current line rate;
- maximum line rate;
- line exposure;
- working and focus distance;
- scan-plane Z;
- reconstructed strip dimensions;
- acquisition progress;
- line-light intensity and polarization.

The viewport should be labelled **Line scanner reconstruction** and show:

- the active 1D scan line;
- scan progress;
- reconstructed 2D strip;
- encoder position and acquired line count.

Do not label this as a normal camera view.

### Scene and Schema

Render by acquisition type in `src/scene/cameraRig.tsx`:

- Area camera: existing body, lens, and frustum.
- Line scanner: elongated housing, optical line, and thin scan plane.

Schema should display, for the selected line scanner only:

- cross-belt scan width;
- scan-plane location;
- encoder/travel direction;
- required line rate at current speed;
- bottom-gap alignment;
- working distance.

### Preset Updates

The report/default preset becomes:

- four oblique `AREA_SCAN` readers;
- one TOP `LINE_SCAN` reader;
- one BOTTOM `LINE_SCAN` reader;
- bottom transfer set to `GAP`;
- bottom scan plane centred in the gap;
- explicit top and bottom line illumination.

Review other presets:

- Camera failure: disable the TOP line scanner.
- Bottom gap: enable and expose the BOTTOM scanner.
- Side grip: preserve a clear bottom scan plane.
- Glare stress: affect line-light intensity/polarization.
- Close spacing: stress strip segmentation and assignment.
- Small module: stress both cross-belt and along-travel sampling.

---

## Data Enrichment for the Explainer

The existing live observation audit includes PPM, incidence, confidence, quality pass/fail, and reasons, but not every preprocessing component.

Additive fields should include:

- acquisition type;
- coverage;
- distance;
- blur or line smear;
- cross-belt PPM;
- travel-axis PPM for line scans;
- quality components;
- quality gate failures;
- scan-session and encoder-range metadata where applicable.

Existing CSV compatibility may remain stable while JSON audit/run exports gain the additional fields.

---

## Testing Plan

### How It Works Model

- Correct stage order and grouping.
- Fresh, entered, captured/scanning, decoded, and completed parcels.
- Area and line acquisition branches merge correctly.
- Quality failure and successful decode.
- Association mismatch.
- Repeated observations versus repeated payloads.
- All final result statuses.
- Reset and missing-data behavior.

### How It Works View

- Fifth navigation item and correct route.
- Previous/Next boundaries.
- Direct step selection and `aria-current`.
- Parcel selection and follow-newest behavior.
- Live evidence matches the selected parcel.
- Technical-details expansion.
- Useful rendering without WebGL.
- No pause/reset or other mutation on navigation.

### Line-Scanner Domain and Config

- Old configurations migrate to area scan.
- New defaults contain four area cameras and two line scanners.
- Type-specific validation accepts valid configurations and rejects invalid ones.
- Config export/import round-trip remains deterministic.

### Line-Scanner Scheduling

- Session starts at front-edge crossing.
- Line count matches encoder displacement.
- Session completes at rear-edge crossing.
- Speed changes create neither duplicate nor missing encoder distance.
- Maximum line rate causes measurable undersampling.
- Pause produces no lines.
- Reset clears active sessions.
- Fault produces an aborted/incomplete scan.
- Close parcels remain assigned to the correct sessions.

### Line-Scanner Observation

- TOP scanner observes TOP labels only.
- BOTTOM scanner requires a visible transfer opening.
- Effective PPM uses the weaker sampling axis.
- Rotated labels affect sampling correctly.
- Exposure produces travel-direction smear.
- Incomplete strips fail safely.
- Focus, lighting, glare, contrast, and damage remain explainable.

### End-to-End and Regression

- Same seed/configuration produces equivalent results at different display refresh rates.
- Area and line observations aggregate together.
- Separate label instances with equal payloads remain distinct.
- Baseline TOP/BOTTOM labels decode successfully.
- Solid-deck bottom labels do not decode.
- Scanner faults never fabricate successful reads.
- Existing Operations, Camera Lab, Schema, Metrics, exports, and presets remain functional.

### Performance

- No per-line event-log explosion.
- No per-line Three.js rendering.
- Preview buffers remain bounded and disposable.
- The existing ten-parcel CPU budget remains green.
- Production build, typecheck, lint, and complete test suite pass.

---

## Delivery Sequence

### Phase 1: Typed foundation

1. Add area/line acquisition types.
2. Add config migration and conditional validation.
3. Convert the default/report TOP and BOTTOM readers.

### Phase 2: Line-scan domain model

1. Add scan geometry and pure sampling helpers.
2. Add encoder-synchronized sessions.
3. Add bounded scan lifecycle events.
4. Prove determinism with tests before adding UI.

### Phase 3: Observation and pipeline integration

1. Produce line-scan label observations.
2. Add interval-based association.
3. Feed line observations into existing decode and aggregation.
4. Verify final status behavior and metrics.

### Phase 4: Visualization and controls

1. Render line-scanner bodies, scan planes, and line lights.
2. Add reconstructed strip previews.
3. Add line-scanner Camera Lab controls.
4. Update Schema with selected-scanner annotations.

### Phase 5: How It Works tab

1. Build the pure guide and evidence model.
2. Add route, navigation, and accessible stepper.
3. Add the area/line acquisition branches.
4. Connect live parcel evidence and result data.

### Phase 6: Hardening

1. Update all presets, exports, and documentation.
2. Complete responsive and accessibility work.
3. Run deterministic, end-to-end, performance, and regression suites.

---

## Acceptance Criteria

- A reviewer can understand the complete parcel and data journey in approximately two minutes.
- The tab clearly states when parcel IDs and label-instance IDs are assigned.
- Preprocessing and postprocessing are explained separately.
- Area-frame and line-strip acquisition are shown accurately.
- TOP and BOTTOM use encoder-synchronized line-scan sessions in the default/report station.
- Bottom scans require physically valid line of sight through the transfer opening.
- Speed changes alter required line rate without breaking determinism.
- Undersampling, incomplete strips, faults, and association problems fail explicitly.
- Four side area cameras and two line scanners contribute to one shared parcel aggregate.
- Visible previews are never presented as the source of synthetic decode decisions.
- The new tab is readable without orbit controls, overlapping labels, or WebGL.
- Existing application views and exported records remain compatible or are migrated explicitly.

## Non-Goals

- Claiming validated optical performance without a physical proof of concept.
- Implementing a proprietary barcode decoder.
- Decoding the displayed Three.js pixels.
- Simulating every electrical detail of a real encoder or PLC.
- Emitting or rendering every individual scan line as a separate application event.
