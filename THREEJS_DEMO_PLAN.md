# Three.js Conveyor Barcode Demo

Product requirements, engineering plan, issue backlog, and demo acceptance criteria

Status: implementation-ready proposal  
Source problem: Ozon Tech test assignment, variant 2  
Reviewed solution: the supplied draft by Mikhail Krylov

## 1. Executive decision

Build a deterministic browser simulation that explains the proposed six-sided scanning station and produces inspectable synthetic camera observations. The demo should be an engineering explainer, not a claim that WebGL validates a physical camera purchase.

The recommended stack is React + TypeScript + Three.js through React Three Fiber. React owns the controls, tables, timelines, and metrics; Three.js owns the world, cameras, camera frusta, and off-screen camera views. Barcode textures should be generated locally with `bwip-js` or `JsBarcode`. A small standalone simulation store should advance time and publish domain events independently of React rendering.

The demo has two pipeline modes:

1. `Geometry model` - the required MVP. Decode success is computed from ground-truth geometry, projected pixels per module, angle, visibility, blur, glare, focus, and a seeded error model.
2. `Pixel decoder` - an optional stretch goal. Selected rendered frames are passed to a browser barcode decoder. It is useful as a demonstration, but it still does not validate real optics, illumination, sensor noise, or motion.

Use six logical views by default: front, rear, left, right, top, and bottom. Model the bottom view with a short side-grip transfer that exposes the complete lower surface. A 100 mm gap between ordinary conveyor sections can be retained as an alternate scenario, but it cannot honestly guarantee reading a label placed anywhere on the bottom face.

## 2. What the demo must prove

The demo must make these ideas visible and testable:

- a parcel receives one `parcelId` at station entry;
- every captured frame and observation identifies its camera, time, pose, and candidate parcel IDs;
- labels may appear on any face, in multiple locations and rotations, including repeated payload values;
- camera placement and optical settings change coverage and read quality;
- observations pass through capture, decode, association, aggregation, and finalization stages;
- the final parcel result is produced before the simulated sort point;
- metrics are calculated against the synthetic ground truth;
- failures are explainable: the UI shows why a label was missed;
- a schema mode communicates dimensions, distances, fields of view, and angles without visual clutter.

The demo must not claim to prove:

- the real read rate of a named industrial camera;
- the correct real-world lens, depth of field, illumination, polarization, or enclosure design;
- real Code 128 performance on damaged, wrinkled, glossy, or poorly printed labels;
- mechanical safety or suitability of the side-grip transfer;
- production PLC timing, functional safety, or industrial network reliability.

## 3. Review of the current solution

### 3.1 What is already good

- It starts from field of view, module size, pixels per module, exposure, and motion blur instead of choosing a camera by resolution alone.
- It recognizes the need for global shutter, controlled lighting, polarization, photoelectric sensors, multiple frames, and a local decoder.
- It assigns observations to a `ParcelID` and proposes full-parcel, barcode-level, duplicate, and latency metrics.
- It notices that the bottom face needs a dedicated optical path.

### 3.2 Issues that should be corrected or made explicit

| ID | Severity | Finding | Resolution in the demo |
|---|---|---|---|
| REV-01 | Critical | `600 x 400 x 400 mm` has no declared axis order. Several calculations implicitly use different orientations. | Define `x = across belt`, `y = up`, `z = direction of travel`; default parcel is `400 x 400 x 600 mm` in x/y/z, and make all dimensions configurable. |
| REV-02 | Critical | A 100 mm conveyor gap does not expose an arbitrary point on the bottom while the parcel remains supported. | Default to a side-grip transfer; keep the simple gap only as a visibly limited alternative. |
| REV-03 | High | The estimate of Code 128 module width from alphabet size is not valid. Encoded width depends on the actual symbol sequence and code set. | Generate the exact symbol, record its module count, and use an explicit `xDimensionMm` parameter. Default to 0.30 mm as a test assumption, not a fact. |
| REV-04 | High | “Four cameras at 45 degrees cover every vertical face” is vulnerable to occlusion, perspective, and leading/trailing-face timing. | Use explicit front/rear/left/right views. Offer the four-oblique-camera layout only as a comparison preset. |
| REV-05 | High | Photoeyes alone are weak when speed varies, parcels stop, or intervals shrink. | Add an encoder position to each observation. Associate observations primarily by position window and use time for diagnostics. |
| REV-06 | High | The pasted draft does not define concrete camera models or a complete camera data model. | Provide a generic configurable camera plus an optional preset matching the proposed 16 MP industrial-reader concept. Do not imply a purchase recommendation from the simulation. |
| REV-07 | High | “Read all labels” cannot be verified online unless the expected physical label count is known. | The simulator owns ground truth. The UI clearly distinguishes `observed`, `decoded`, and `expected` labels. |
| REV-08 | Medium | Perspective correction is marked as mandatory, but modern decoders often localize and rectify internally; unconditional warping may degrade an image. | Represent rectification as an optional pipeline stage and compare enabled/disabled behavior. |
| REV-09 | Medium | Cropping static regions only saves upstream bandwidth if the ROI is applied in the camera/reader, not after a full image has already been transferred. | Show sensor ROI separately from edge-side crop and report bytes at both boundaries. |
| REV-10 | Medium | `Duplicate Rate` is ambiguous. Two physical labels may legally contain the same payload. | Track `labelInstanceId` separately from `payload`; measure accidental repeated observations and preserve legitimate repeated payloads. |
| REV-11 | Medium | Precision has no definition, and misassociation is not listed. | Define barcode precision, recall, complete-read rate, false decode rate, parcel misassociation rate, and latency percentiles. |
| REV-12 | Medium | A native 16 MP x six-feed simulation at 20-30 FPS is not practical in a normal browser. | Keep physical sensor resolution as metadata and use lower-resolution preview render targets. Quality math uses the physical resolution. |

## 4. Agreed simulation assumptions

These values are defaults, not hidden constants.

| Parameter | Default | Notes |
|---|---:|---|
| Conveyor width | 650 mm | x-axis |
| Conveyor speed | 1,000 mm/s | adjustable 0-1,500 mm/s |
| Parcel dimensions | 400 x 400 x 600 mm | width x height x length |
| Spawn interval | 2.0 s | interpreted as front-to-front time; at the defaults the physical surface gap is about 1,400 mm |
| Station length | 2,200 mm | editable schema dimension |
| Sort-point distance | 1,250 mm after exit | adjustable, never greater than 3,000 mm |
| Cameras | 6 | front, rear, left, right, top, bottom |
| Sensor metadata | 5,320 x 3,032 px | logical/native resolution |
| Preview target | 960 x 540 px max | adaptive; not used for physical PPM calculations |
| Lens | 16 mm | preset only; configurable |
| Working distance | about 850 mm | derived from placement, not duplicated as an independent truth |
| Exposure | 75 microseconds | configurable |
| Capture rate | 20 FPS | configurable; previews may update more slowly |
| Shutter | global | rolling shutter is a comparison/fault mode |
| Barcode | Code 128 | 78 x 25 mm label, about 60 x 16.7 mm bar area |
| Module X dimension | 0.30 mm | explicit test assumption |
| Payload pattern | `KTY-` + 14 digits | ASCII-safe; the visually similar Cyrillic `Я` is not used in the default Code 128 payload |

## 5. User experience and views

### 5.1 Operations view

This is the primary presentation view.

- Central 3D station with an orbit camera, moving parcels, label decals, photoeyes, sort point, and camera status lights.
- Camera strip with six feeds. Each tile shows `cameraId`, state, frame age, visible parcel IDs, decoded count, and warning state.
- Pipeline timeline for the selected parcel: `spawned -> entered -> captured -> decoded -> aggregated -> finalized -> PLC ACK`.
- Parcel result card with expected labels, observations, unique physical instances, payloads, status, and latency.
- Live metrics: complete-read rate, barcode recall, precision, misassociation, P95 latency, no-read count, and dropped-frame count.

### 5.2 Camera Lab

Select one camera and one parcel, freeze time, and edit:

- position x/y/z in millimetres;
- look target or yaw/pitch/roll;
- sensor width/height in pixels;
- focal length or vertical field of view, with one derived from the other;
- exposure, capture FPS, shutter mode, gain, focus distance, and sensor ROI;
- illumination intensity, polarization toggle, noise, glare sensitivity, and fault state;
- preview resolution and overlay visibility.

The view reports physical FOV at the selected target plane, distance, incidence angle, projected pixels per module, estimated blur in pixels, coverage percentage, and current readability reasons.

### 5.3 Schema view

Schema mode is a separate low-clutter view, not just a wireframe material toggle.

- Orthographic top, side, front, and free-isometric presets.
- Dimension lines for conveyor width, station length, working distance, parcel dimensions, bottom opening, and sorter distance.
- Camera frusta, optical axes, focus planes, sensor ROI, and named scan zones.
- Angle arcs for camera incidence and parcel yaw.
- Barcode face normal, distance-to-camera line, and projected size annotation.
- Toggle groups: `dimensions`, `frusta`, `angles`, `scan zones`, `mechanics`, `labels`, and `sensor IDs`.
- Freeze, step one frame, fit selection, and export screenshot.

### 5.4 Metrics and run review

- Run summary and per-camera table.
- Breakdown by face, material, label rotation, incidence-angle band, and PPM band.
- A parcel-by-parcel failure table with explicit reason codes.
- Seed, configuration hash, start time, simulated duration, and software version.
- Export run configuration and observations as JSON; export metrics as CSV.

## 6. Functional requirements

### World and motion

- **SIM-001** - Use millimetres as domain units and a documented x/y/z coordinate system.
- **SIM-002** - Move parcels from spawn to sorter using a deterministic fixed simulation step; visual interpolation may run at display rate.
- **SIM-003** - Support run, pause, reset, single-step, 0.25x/0.5x/1x/2x, and a numeric random seed.
- **SIM-004** - Create entry and exit photoeye events and a belt encoder position. Speed changes must not break parcel association.
- **SIM-005** - Support one or more parcels in the station without sharing mutable label state.

### Parcels, materials, and barcodes

- **PAR-001** - Configure parcel dimensions, lateral offset, yaw, speed, spawn interval, material, and tape patches.
- **PAR-002** - Generate 1-N labels per parcel from a seeded generator; default range is 1-4.
- **PAR-003** - Allow labels on all six faces, including multiple labels on one face.
- **PAR-004** - Randomize label position and in-plane rotation while keeping the label inside the face unless an explicit damaged/partial scenario is selected.
- **PAR-005** - Store both `labelInstanceId` and `payload`; repeated payloads must remain separate physical labels.
- **PAR-006** - Render a scannable Code 128 texture with correct quiet zones and a human-readable line.
- **PAR-007** - Configure label size, X dimension, print contrast, damage, occlusion, gloss, and allowed faces.
- **PAR-008** - Provide material presets: kraft cardboard, white cardboard, dark cardboard, glossy tape, matte wrap, and custom color/roughness.

### Cameras and captures

- **CAM-001** - Create a `CameraRig` entity with pose, intrinsics, acquisition, illumination, preview, and health settings.
- **CAM-002** - Support six default cameras and adding, cloning, disabling, moving, or deleting user cameras.
- **CAM-003** - Derive Three.js camera projection from sensor aspect and focal length/FOV. Update frusta immediately after edits.
- **CAM-004** - Implement states `OFFLINE`, `IDLE`, `ARMED`, `CAPTURING`, `PROCESSING`, and `FAULT`.
- **CAM-005** - Capture only when the camera is enabled, healthy, scheduled, and its trigger zone is active.
- **CAM-006** - Render each active capture to an off-screen target and retain a bounded recent-frame buffer.
- **CAM-007** - Attach complete metadata to every frame: camera state, pose, intrinsics, exposure, gain, FPS, shutter, illumination, simulation time, encoder position, candidate parcel IDs, and render-target size.
- **CAM-008** - Show overlays for parcel IDs, ground-truth label boxes, predicted boxes, read results, PPM, angle, distance, blur, and rejection reasons.
- **CAM-009** - Model camera/illumination faults and visibly propagate them into observations and parcel status.

### Image formation and optical failure simulation

The camera feed must not remain a clean game-engine render while the metrics claim blur or glare. Each effect has two coupled outputs: a measured value used by the quality model and a visible degradation in the preview.

- **IMG-001** - Calculate motion blur from relative parcel/camera motion during exposure. Project the same barcode reference points at shutter-open and shutter-close time; their screen-space displacement is `blurPx`.
- **IMG-002** - Provide two visual motion-blur modes:
  - `interactive`: a screen-space directional convolution aligned to the calculated motion vector;
  - `accurate capture`: render 4-16 temporal subframes across the exposure interval and accumulate them into one frame.
- **IMG-003** - Keep real scale and “demonstration amplification” separate. At 1 m/s and 75 microseconds the physical travel is only 0.075 mm and may be nearly invisible in a 960 x 540 preview. An `amplify artifacts` control may enlarge the visible effect, but overlays and metrics must continue to show the unmodified physical value.
- **IMG-004** - Simulate global and rolling shutter. For rolling shutter, offset capture time by image row using a configurable sensor readout duration, producing visible skew on moving parcels and labels.
- **IMG-005** - Simulate exposure as both integration time and brightness. Long exposure increases blur and brightness; insufficient illumination produces underexposure; excessive illumination clips white label regions.
- **IMG-006** - Simulate gain, shot-noise approximation, read noise, quantization, and optional compression artifacts with deterministic seeded shaders or post-processing.
- **IMG-007** - Simulate focus error and depth-of-field from focus distance, aperture proxy, and depth texture. Report an estimated defocus blur radius independently from motion blur.
- **IMG-008** - Use physically based parcel, ink, label, and tape materials so light angle and roughness create glare. Polarization is a simplified configurable reduction of the specular component and must be labelled as an approximation.
- **IMG-009** - Support illumination controls: position, angle, size, intensity, strobe duration, ambient leakage, and optional 50/60 Hz flicker scenario.
- **IMG-010** - Support print defects in the barcode texture: low contrast, missing bars, abrasion, folds, local occlusion, dirt, and quiet-zone violation.
- **IMG-011** - Support optional lens effects: radial distortion, vignetting, and a mild chromatic-aberration comparison. These are P1 and disabled in the recommended preset.
- **IMG-012** - Effects must be independently toggleable so a reviewer can isolate one cause and compare `clean`, `physical`, and `amplified` feeds side by side.

### Observation and processing pipeline

- **PIPE-001** - For every label, determine face orientation, frustum inclusion, projected corner positions, occlusion, coverage fraction, distance, and incidence angle.
- **PIPE-002** - Calculate projected PPM from the physical sensor model, not the preview resolution.
- **PIPE-003** - Calculate motion blur using relative image-plane motion, exposure, and local pixels/mm; global shutter is the default.
- **PIPE-004** - Produce a deterministic quality score with separate components for coverage, PPM, angle, blur, focus, contrast, glare, occlusion, and print damage.
- **PIPE-005** - Emit reason codes such as `OUT_OF_FOV`, `BACK_FACING`, `OCCLUDED`, `LOW_PPM`, `HIGH_ANGLE`, `MOTION_BLUR`, `GLARE`, `LOW_CONTRAST`, `OUT_OF_FOCUS`, and `CAMERA_FAULT`.
- **PIPE-006** - Implement the stages `capture -> candidate -> quality -> decode -> associate -> deduplicate observations -> aggregate parcel -> finalize -> ACK`.
- **PIPE-007** - Keep legitimate identical payloads as separate instances; collapse repeated reads only when they refer to the same physical label.
- **PIPE-008** - Associate observations to a parcel using encoder position windows, then validate with time and visible geometry.
- **PIPE-009** - Finalize a parcel after the exit event plus a configurable grace period and produce `OK`, `NO_READ`, `PARTIAL`, `SENSOR_FAULT`, or `AMBIGUOUS`.
- **PIPE-010** - Optional pixel-decoder mode must use the same observation/result contracts and report its mode in every run.

### Metrics and audit

- **MET-001** - `completeReadRate = parcels with all expected label instances decoded / evaluated parcels`.
- **MET-002** - `barcodeRecall = correctly decoded label instances / expected label instances`.
- **MET-003** - `barcodePrecision = correct decoded instances / all decoded instances`.
- **MET-004** - Track false decode and parcel misassociation separately.
- **MET-005** - Track repeated observations collapsed by the aggregator; do not classify identical payloads as duplicates by value alone.
- **MET-006** - Track capture-to-decode, entry-to-result, exit-to-result, and exit-to-ACK latency with P50/P95/P99.
- **MET-007** - Break metrics down by camera, parcel face, material, label rotation, PPM band, incidence-angle band, and failure reason.
- **MET-008** - Preserve an immutable run record containing seed, configuration, ground truth, frames metadata, observations, results, and metrics.

### Configuration

- **CFG-001** - All user-editable values must be changed through validated controls with units.
- **CFG-002** - Provide presets: `recommended 6-view`, `draft 4-oblique`, `bottom gap`, `side-grip`, `glare stress`, `small-module stress`, `camera failure`, and `close-spacing`.
- **CFG-003** - Support JSON import/export with a versioned schema.
- **CFG-004** - Resetting a preset must reproduce the same run for the same seed.

## 7. Camera and observation contracts

```ts
type CameraState =
  | 'OFFLINE'
  | 'IDLE'
  | 'ARMED'
  | 'CAPTURING'
  | 'PROCESSING'
  | 'FAULT';

interface CameraConfig {
  id: string;
  name: string;
  role: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' | 'CUSTOM';
  pose: {
    positionMm: [number, number, number];
    quaternion: [number, number, number, number];
  };
  sensor: {
    widthPx: number;
    heightPx: number;
    focalLengthMm: number;
    filmGaugeMm: number;
    nearMm: number;
    farMm: number;
    roi?: { x: number; y: number; width: number; height: number };
  };
  acquisition: {
    fps: number;
    exposureUs: number;
    gainDb: number;
    shutter: 'GLOBAL' | 'ROLLING';
    focusDistanceMm: number;
    rollingReadoutUs: number;
  };
  illumination: {
    intensity: number;
    polarized: boolean;
    strobeUs: number;
    ambientLeak: number;
    flickerHz?: 50 | 60;
  };
  optics: {
    apertureProxy: number;
    radialDistortion: [number, number];
    vignetting: number;
  };
  imageEffects: {
    motionBlur: 'OFF' | 'DIRECTIONAL' | 'TEMPORAL_ACCUMULATION';
    temporalSamples: number;
    shotNoise: number;
    readNoise: number;
    compression: number;
    artifactAmplification: number; // presentation only; excluded from metrics
  };
  preview: { widthPx: number; heightPx: number; overlay: boolean };
  enabled: boolean;
}

interface FrameObservation {
  frameId: string;
  runId: string;
  cameraId: string;
  cameraState: CameraState;
  simTimeMs: number;
  encoderPositionMm: number;
  cameraSnapshot: CameraConfig;
  preview: { widthPx: number; heightPx: number; textureRef: string };
  candidateParcelIds: string[];
  labels: LabelObservation[];
  processingMode: 'GEOMETRY_MODEL' | 'PIXEL_DECODER';
}

interface LabelObservation {
  parcelId: string;
  labelInstanceId: string;
  groundTruthPayload?: string; // hidden from decoder logic; visible only in audit mode
  face: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
  projectedCornersPx: [number, number][];
  coverage: number;
  distanceMm: number;
  incidenceDeg: number;
  pixelsPerModule: number;
  blurPx: number;
  qualityComponents: Record<string, number>;
  decodedPayload?: string;
  confidence: number;
  reasons: string[];
}
```

Important: ground truth exists in the run audit record but must not be read by the simulated decoder when deciding success. The geometry engine may use true geometry to calculate measurable conditions; the seeded quality model decides the synthetic observation outcome.

## 8. Quality model

The MVP does not need to imitate a proprietary decoder. It needs a stable and explainable response to changed geometry.

For each candidate label calculate normalized components in `[0, 1]`:

```text
Q = visibility
  * coverage
  * ppmScore
  * angleScore
  * blurScore
  * focusScore
  * contrastScore
  * glareScore
  * damageScore
```

Use hard gates for impossible conditions and a seeded probability only near the boundary. Example defaults:

- full label coverage >= 0.92;
- projected module width >= 2.0 px, target >= 3.0 px;
- blur <= 1.0 px, target <= 0.5 px;
- incidence <= 60 degrees, target <= 35 degrees;
- no complete occlusion and no camera fault.

Every threshold must be editable and labelled as a simulation assumption. Changing a camera must immediately update the component scores, reason codes, and eventual run metrics.

### 8.1 Motion-blur implementation

The basic engineering value remains:

```text
travelDuringExposureMm = relativeSpeedMmPerSec * exposureUs / 1,000,000
```

For an angled camera, convert that motion into screen space instead of assuming one constant pixels/mm value:

```text
p0 = project(labelPoint at shutter-open)
p1 = project(labelPoint at shutter-close)
blurVectorPx = p1 - p0
blurPx = length(blurVectorPx)
```

Use the maximum or a robust percentile of the four barcode-corner vectors for the quality gate. This naturally accounts for camera pose, perspective, label face, and motion direction.

The interactive feed applies a directional blur along `blurVectorPx`. An “accurate still” button pauses the normal preview scheduler, renders the scene at several times within the exposure interval, and averages those samples. The accumulated image is slower but gives a more defensible explanation of shutter integration.

### 8.2 Other coupled effects

| Problem | Analytic signal | Visual treatment | Important limit |
|---|---|---|---|
| Defocus | circle-of-confusion proxy in pixels | depth-aware blur | not a calibrated lens model |
| Glare/tape | specular angle, light size, roughness, saturation fraction | PBR highlights and clipped regions | polarization is simplified |
| Low light | expected normalized exposure | darker signal plus noise | not a sensor-specific quantum model |
| Gain | gain dB and SNR penalty | brightness plus amplified noise | deterministic approximation |
| Rolling shutter | row readout time and projected displacement | scanline-dependent warp | requires exaggerated preset to be obvious at 75 us |
| Perspective | incidence angle and projected quadrilateral | native perspective render | real decoder robustness is not inferred automatically |
| Occlusion/fold | visible area and damaged modules | geometry/texture mask | procedural damage is representative, not exhaustive |
| Dirty optics | contrast/veiling-glare factor | camera-space dirt and haze mask | maintenance behavior remains conceptual |

## 9. Architecture

```text
React controls and dashboards
            |
            v
Versioned simulation store <------ JSON presets/import
            |
     fixed-step clock
            |
   +--------+---------+
   |                  |
   v                  v
Three.js world    Domain event bus
   |                  |
   v                  v
camera scheduler -> frame metadata + preview texture
                         |
                         v
                  observation engine
                         |
                         v
       decoder -> association -> aggregation
                         |
                         v
              parcel result / simulated ACK
                         |
                         v
                 metrics + run audit
```

Recommended modules:

```text
src/
  app/             routing, layout, error boundary
  scene/           conveyor, parcel meshes, labels, cameras, helpers
  simulation/      fixed clock, spawning, motion, photoeyes, encoder
  domain/          types, IDs, state machines, event contracts
  capture/         camera scheduler, render targets, frame buffer
  observation/     projection, ray tests, PPM, blur, quality model
  pipeline/        decoder adapters, association, aggregation, ACK
  metrics/         counters, latency histograms, breakdowns
  store/           versioned state and selectors
  ui/              controls, camera wall, timeline, tables, charts
  presets/         reviewed scenarios
  export/          JSON, CSV, screenshot
```

Three.js provides physical-style perspective-camera controls, view-size calculation, camera frustum helpers, off-screen render targets, and asynchronous render-target pixel reads. Those primitives are enough for the schema view and optional pixel pipeline. Do not tie the domain clock to React component state on every animation frame.

## 10. Performance and non-functional requirements

- **NFR-001** - Main view target: 55-60 FPS on a recent desktop browser with 10 active parcels and all helpers hidden.
- **NFR-002** - Camera previews target 5-10 visible updates/s; logical captures may remain 20 FPS.
- **NFR-003** - Never allocate six native 5,320 x 3,032 color/depth targets. Reuse bounded preview targets and dispose GPU resources when cameras are removed.
- **NFR-004** - Cap device pixel ratio and drawing-buffer pixel count.
- **NFR-005** - Keep no more than 120 frame metadata objects per camera by default; keep textures only for the latest frame unless capture is explicitly pinned.
- **NFR-006** - A run with the same config version and seed must produce identical domain results independent of display refresh rate.
- **NFR-007** - All numeric controls display units; invalid values are rejected without corrupting the current run.
- **NFR-008** - Camera tiles and charts must not rely on color alone; support keyboard selection and reduced motion.
- **NFR-009** - Desktop-first layouts at 1440 x 900 and 1920 x 1080; minimum supported width 1,024 px.
- **NFR-010** - No backend is required for MVP. The app runs locally after install and can be built as a static site.
- **NFR-011** - Unit-test projection/quality math and state machines; add one deterministic end-to-end baseline scenario.
- **NFR-012** - Include an in-app “Simulation limits” panel and repeat the limitations in the README.

## 11. GitHub issue backlog

The issue numbers below are also the recommended implementation order. An issue may begin only after its listed dependencies expose stable contracts.

| Issue | Depends on | Priority | Estimate | Deliverable and acceptance criteria |
|---|---|---:|---:|---|
| **#1 Scaffold the TypeScript demo** | - | P0 | 0.5 d | Vite/React/Three.js app, lint, tests, CI, responsive shell, and four empty views. |
| **#2 Define units, domain types, seed, and fixed clock** | #1 | P0 | 1 d | Millimetre coordinate system, versioned config, deterministic IDs/RNG, play/pause/step/reset; same seed reproduces an event snapshot. |
| **#3 Build conveyor cell and schema geometry** | #2 | P0 | 1 d | 650 mm conveyor, 2.2 m station, photoeyes, sorter marker, enclosure, side-grip, dimensions; orthographic presets render correctly. |
| **#4 Generate parcels, materials, and Code 128 labels** | #2, #3 | P0 | 1.5 d | Configurable boxes, six-face label placement, 1-N labels, repeated payload case, materials/tape, correct instance IDs and quiet zones. |
| **#5 Implement camera rigs and editable intrinsics** | #2, #3 | P0 | 1.5 d | Six defaults, transform controls, sensor/focal/FOV model, helpers, state lights, validated editor, immediate projection updates. |
| **#6 Add capture scheduler and off-screen feeds** | #4, #5 | P0 | 1.5 d | Trigger zones, camera state machine, reusable render targets, six feed tiles, bounded buffers, frame metadata overlays. |
| **#7 Implement sensor image formation and artifacts** | #4-#6 | P0 | 2.5 d | Directional and temporal motion blur, exposure, noise, focus, glare/tape, global/rolling shutter, clean/physical/amplified comparison, and tests linking visible effects to analytic values. |
| **#8 Implement geometric observations** | #4-#7 | P0 | 2 d | Frustum, facing, projection, ray-based occlusion, coverage, distance, angle, PPM, blur, focus; tested reason codes. |
| **#9 Build the processing and parcel-association pipeline** | #2, #6-#8 | P0 | 1.5 d | Capture-to-ACK stages, deterministic quality model, encoder association, physical-instance deduplication, final status. |
| **#10 Add ground-truth metrics and audit trail** | #2, #4, #9 | P0 | 1.5 d | Required formulas, percentiles, breakdowns, failure table, run record; baseline expected metrics asserted in tests. |
| **#11 Build Operations view** | #3, #6, #9, #10 | P0 | 1.5 d | 3D cell, camera wall, selected-parcel timeline, result panel, live metrics, clear state transitions. |
| **#12 Build Camera Lab** | #5, #7, #8 | P1 | 1.5 d | Freeze/select/edit camera and label; show FOV, PPM, blur, angle, distance, component scores and reasons. |
| **#13 Finish Schema view and screenshot export** | #3, #5, #8 | P1 | 1 d | Top/side/front/isometric, dimension toggles, frusta, angle arcs, scan zones, clean PNG export. |
| **#14 Add presets and fault injection** | #7-#13 | P1 | 1 d | Eight named presets; disable reader, glare, small module, close spacing, rolling shutter, speed change; expected failure is visible throughout the pipeline. |
| **#15 Add JSON/CSV import and export** | #2, #10 | P1 | 1 d | Versioned config import with validation; run JSON, observations JSON, and metrics CSV download. |
| **#16 QA, performance budget, README, and demo script** | #1-#14 | P0 | 1.5 d | Stable 10-parcel run, no GPU leaks, deterministic test, acceptance scenarios, 1440x900 review, limitations, install/build instructions, 5-minute walkthrough. |
| **#17 Optional real pixel decoder adapter** | #6-#10 | P2 | 2-4 d | Selected captured frames enter ZXing/WASM or equivalent; adapter emits the same contract; geometry and pixel results can be compared. |
| **#18 Optional PLC protocol visualizer** | #9-#11 | P2 | 1 d | Show outbound payload, retry with same message ID, ACK/no-ACK, and fail-safe routing. |

Estimated focused effort:

- functional end-to-end core (#1-#10): about 14.5 engineering days;
- presentable MVP (#1-#14 and #16): about 21.5 engineering days;
- full planned demo (#1-#16): about 22.5 engineering days;
- optional pixel decoding: add 2-4 days plus browser compatibility work.

### 11.1 Dependency flow

```text
#1 project shell
  -> #2 domain model and deterministic clock
      -> #3 physical station
          -> #4 parcels and barcode ground truth
          -> #5 camera model
              -> #6 camera captures
                  -> #7 visible sensor artifacts
                      -> #8 measurements and observations
                          -> #9 association and parcel result
                              -> #10 metrics and audit
                                  -> #11 Operations view

#5 + #7 + #8  -> #12 Camera Lab
#3 + #5 + #8  -> #13 Schema view
#7 through #13 -> #14 scenarios and faults
#2 + #10      -> #15 import/export
#1 through #14 -> #16 final QA and demo
```

### 11.2 Feature traceability

| User-facing feature | World/input source | Processing connection | Output | Issues |
|---|---|---|---|---|
| Random parcels and labels | seeded parcel generator and barcode textures | creates immutable ground truth | visible parcel plus expected label instances | #2-#4 |
| Configurable cameras | camera pose, sensor, lens, exposure, light | changes captures, PPM, angle, blur, focus, and quality | camera feeds and updated read outcomes | #5-#8, #12 |
| Camera state and observations | triggers, photoeyes, encoder, state machine | schedules captures and associates observations | frame metadata, candidate parcel IDs, reason codes | #2, #6, #8, #9 |
| Motion blur and imaging problems | movement, exposure, material, illumination | analytic quality signal and matching visual effect | degraded feed and explainable failure | #7, #8, #12 |
| Pipeline processing | observations from every active camera | decode, associate, cluster, aggregate, finalize, ACK | one parcel result with status | #8, #9, #11 |
| Metrics | ground truth plus finalized results | compare physical instances, payloads, parcel IDs, and latency | recall, precision, complete-read, failures, percentiles | #10, #11 |
| Materials and glare | parcel/label/tape PBR parameters and lighting | glare, contrast, and saturation components | visible highlight plus quality change | #4, #7, #12, #14 |
| Schema view | shared station and camera configuration | reads the same geometry used for observations | dimensions, frusta, axes, distances, and angles | #3, #5, #8, #13 |
| Fault scenarios | presets mutate real camera/pipeline configuration | effects propagate through normal processing | fault states, safe result, changed metrics | #7, #9, #10, #14 |
| Export | versioned store and immutable audit record | no separate calculation path | reproducible JSON/CSV evidence | #2, #10, #15 |

## 12. Milestones

### M1 - Explainable world

Issues #1-#5. A reviewer can inspect the station, parcels, labels, camera placement, dimensions, and frusta. No processing claim yet.

### M2 - End-to-end synthetic scan

Issues #6-#10. One seeded parcel travels through the station, produces visibly degraded frames and analytic observations, is associated by encoder window, finalizes, and updates metrics.

### M3 - Presentation-ready demo

Issues #11-#14 and #16. All views are polished, stress scenarios work, failures are explainable, and the run is smooth at presentation resolution.

### M4 - Portable evidence

Issue #15. Configurations and results can be exported and attached to the report or used in later regression tests.

### M5 - Optional pixel experiment

Issue #17. Demonstrate decoding a rendered frame, explicitly labelled as a synthetic pixel experiment rather than real camera validation.

## 13. Demo acceptance scenarios

### AC-01 Baseline complete read

Given the recommended six-view preset and seed `2026`, when 20 clean kraft parcels with 1-4 labels traverse at 1 m/s, then every physical label instance is visible in the audit view, the result is associated to the correct parcel, and the UI reports 100% synthetic complete-read for the deliberately easy baseline.

### AC-02 Multiple labels and repeated payload

Given three labels on one face and two labels on different faces with identical payload strings, when the parcel finalizes, then all five `labelInstanceId` values remain present while repeated frames of the same instance are collapsed.

### AC-03 Camera change affects the pipeline

Given a readable top label, when the top camera is moved farther away or its sensor width is reduced until PPM crosses the threshold, then the feed, PPM display, reason code, parcel status, and metrics all update coherently.

### AC-04 Exposure and speed

Given a readable side label, when speed or exposure is increased until blur exceeds the configured threshold, then the observation reports `MOTION_BLUR` and the metrics reflect the miss.

### AC-05 Bottom-face truthfulness

Given a bottom label near an edge, when the station uses the simple-gap preset, then the label is occluded or only partially covered; when switched to the side-grip preset, the label becomes fully observable.

### AC-06 Fault handling

Given a parcel with a label only visible to the left camera, when that camera enters `FAULT`, then no stale result is reused, the health mask changes, and the parcel ends as `SENSOR_FAULT` or `PARTIAL` according to the configured policy.

### AC-07 Close parcels and speed variation

Given two parcels with a reduced gap and a belt speed change, when both cross the station, then observations are associated by encoder windows, no label moves to the neighboring parcel, and ambiguous data fails safe.

### AC-08 Determinism

Given identical config and seed, when the run is repeated at different display refresh rates, then domain events, outcomes, and metrics are byte-for-byte equivalent after removal of wall-clock UI timestamps.

### AC-09 Schema communication

Given a reviewer unfamiliar with the project, when Schema view is opened, then they can identify conveyor width, parcel dimensions, camera working distance, FOV, incidence angle, bottom opening, flow direction, and sorter distance without opening a settings panel.

### AC-10 Export

Given a completed run, when JSON and CSV are exported, then the files contain the config version, seed, ground truth, camera snapshots, observations, parcel results, and all displayed metric values.

## 14. Five-minute presentation script

1. Open Schema view and explain the 650 mm belt, parcel axes, six views, side-grip bottom opening, and sorter distance.
2. Switch to Operations and start seed `2026`. Select one parcel and follow its ID through photoeye entry, camera frames, observations, aggregation, and ACK.
3. Open the parcel result and show multiple physical labels, including two instances with the same payload.
4. Open Camera Lab for a side camera. Move it or change focal length and point out the live changes in FOV, distance, angle, PPM, and feed.
5. Increase exposure or add glossy tape until the selected label becomes unreadable. Show the explicit reason and metric change.
6. Switch from the bottom-gap preset to side-grip and show why the full bottom surface becomes observable.
7. Trigger a camera fault and show fail-safe parcel status rather than a fabricated successful read.
8. Finish on Metrics, state that the numbers are synthetic ground-truth regression metrics, and explain that a real PoC is still required for optical validation.

## 15. Definition of done

The demo is ready when:

- all P0 issues are complete;
- acceptance scenarios AC-01 through AC-09 pass;
- the same seed is deterministic;
- all six camera feeds show synchronized metadata and parcel IDs;
- camera changes affect both pictures and pipeline measurements;
- motion blur, exposure, focus, glare, noise, and rolling shutter can be isolated, and their visible effects agree with the reported physical measurements;
- every no-read has at least one visible reason code;
- legitimate repeated payloads are not lost;
- the bottom-face limitation and solution are demonstrable;
- the app remains smooth for a 10-parcel scene on the presentation machine;
- the README distinguishes simulation evidence from physical validation;
- a clean install, test, build, and local run are documented.

## 16. Decisions needed before implementation

Recommended defaults are supplied so implementation can start, but these choices should be confirmed before visual polish:

1. Use the six-view station as the primary design and keep the four-oblique-camera layout only as a comparison preset.
2. Use the side-grip bottom transfer as the honest all-six-faces scenario.
3. Treat the geometry-based pipeline as MVP and the real pixel decoder as a stretch goal.
4. Use a browser-only static app for the first version; add a backend only if runs must be shared between users.
5. Use English UI labels with a Russian/English glossary, or localize the whole UI. The implementation should not mix languages ad hoc.

## 17. Technical references

- Three.js `PerspectiveCamera`: focal length, effective FOV, and view-size helpers - https://threejs.org/docs/pages/PerspectiveCamera.html
- Three.js `CameraHelper`: frustum visualization - https://threejs.org/docs/pages/CameraHelper.html
- Three.js render targets - https://threejs.org/manual/pages/rendertargets.html
- Three.js renderer: scissor, render-target, and async pixel-read APIs - https://threejs.org/docs/pages/WebGLRenderer.html
- React Three Fiber render-loop hooks - https://r3f.docs.pmnd.rs/api/hooks
- `bwip-js` browser barcode generation - https://github.com/metafloor/bwip-js
