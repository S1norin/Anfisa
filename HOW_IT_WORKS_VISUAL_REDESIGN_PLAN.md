# Visual “How It Works” redesign plan

## Goal and scope

Make the demo a focused explanation of **how a parcel is scanned**, with a guided replay and a separate live image-processing module. Both keep a 3D system view beside the selected sensor's image and show how observations become values assigned to a parcel. This is a plan; it does not change the app yet.

Use the attached workshop PDF as the geometry and process reference: entry photoeye and encoder tracking; top and bottom line scanners in the first section; six side 2D cameras in the second; local barcode decoding; parcel association and deduplication. The PDF does not specify an edge detection algorithm, so the edge map below is a proposed explanatory processing step.

## What the product becomes

One route, `#/how-it-works`, becomes the home screen, with two separate modules inside it: **Guided Replay** and **Live Processing**. Retire the other top-level screens from navigation: Operations, Camera Lab, Schema, and Metrics. Bring only their useful presentation pieces into these two modules: the 3D station, camera images, focused measurements, and final parcel result. Keep simulation, capture, decoding experiments, association, aggregation, and tests in the codebase until the new screen is working; removing a route does not require deleting the engine behind it.

Show **one selected parcel** as a repeatable story. Default to a curated sample with visible top and side labels. Offer a second sample with glare or a missed read to explain failure. The user can play, pause, scrub, step backward/forward, restart, and switch between **System view** and **Camera view**. Every panel must follow the same parcel, sensor, and replay time. Do not auto-switch to a new parcel midway through an explanation.

### Screen layout

- **Left, persistent:** 3D conveyor and scanning box. Highlight the active photoeye, scan plane, or camera. Keep the parcel visible and show its direction of travel. Allow orbiting, plus fixed top, side, and sensor viewpoints.
- **Right, persistent:** the selected camera's raw frame or growing line-scan strip. A comparison slider or paired images shows the selected processing stage's input and output. An overlay marks the parcel ROI, barcode candidate, or decoded region as appropriate.
- **Bottom:** a short story timeline with numbered steps, play/pause, replay speed, and a concise explanation of “input → operation → output”. Show the current parcel ID throughout.
- **Final step:** a compact result card listing unique barcode values, their source sensors, duplicate reads merged, timestamp, and status. Keep technical values behind a details control.

## Storyboard

| Step | System / 3D view | Camera / processing view | Point to teach |
| --- | --- | --- | --- |
| 1. Parcel enters | A labeled box moves through the entrance photoeye; `ParcelID` appears and the encoder ruler begins advancing. | No image yet; show the acquisition timeline arming. | The parcel identity and position are established before any image is attributed to it. |
| 2. Line-scan capture | Top and bottom cross-belt scan planes glow as the box crosses them. Reveal the bottom optical gap. | Show one thin 1D sensor row, then append rows in encoder order into a 2D top or bottom strip. A marker relates the current row to the box's position. | Belt motion supplies the second image axis. The bottom view exists only where the gap exposes the underside. |
| 3. Line-scan image preparation | Hold the box at the end of the first section. | Raw strip → static mask / parcel crop → luminance and contrast adjustment → edge/transition map → barcode candidate box → rectified barcode crop. Show each output as a real image, with a small label naming the operation. | Preparation narrows the search and makes the bars easier to read. Edge marks indicate transitions; they are not decoded values. |
| 4. Line-scan decode | Highlight the top or bottom reader that found the candidate. | Draw one or more sample lines across the rectified barcode, show dark/light run widths, then a decoded Code 128 string or an explicit no-read reason. | Decoding reads bar patterns and validates the symbol. |
| 5. Side-camera capture | The parcel enters the second section; six camera directions appear, with the chosen camera's cone emphasized. | Show several captured 2D frames as thumbnails, then enlarge one. Switchable camera chips reveal how the same label changes with viewing angle. | Multiple viewpoints handle label position and parcel rotation. |
| 6. Side-image preparation | Freeze the camera and box pose that produced the frame. | Raw frame → static mask and parcel ROI → luminance/contrast adjustment → edge map → barcode candidate quadrilateral → perspective-corrected crop → decode. Annotate glare or blur when present. | The 2D path localizes a candidate, corrects its skew when needed, then reads it. |
| 7. Assign reads to parcel | Sensor observations travel as small cards toward the tracked parcel. | Show observation rows: sensor, capture time or encoder interval, candidate, decoded value, and accept/reject reason. Match each row to the parcel's time/position window. | A decoded string becomes a parcel read only after association. |
| 8. Combine and finish | The parcel leaves the box and reaches the output point. | Repeated reads of the same physical label collapse into one entry; distinct labels remain distinct. Show final `ParcelID`, unique values, status, and timestamp. | Deduplication and finalization turn many images into one parcel result. |

The timeline should branch visually between **line scan** and **2D camera** after entry, then merge at association. “Image preprocessing” ends at the prepared candidate crop. “Postprocessing” means association, deduplication, and finalization; it should not be presented as another image filter.

## Truthfulness of the visualization

The current main pipeline makes analytic decisions from geometry and quality measurements. Its line-scan preview is display-only, and the optional pixel decoder in Camera Lab runs only on demand. The new page must not imply that an edge image caused an analytic verdict.

Implement the visible image stages as actual transformations of **one frozen synthetic capture**. Keep a `captureId` that ties raw image, ROI, edge map, rectified crop, candidate, and displayed decode together. Use a real pixel decoder for the replay's displayed decoded value where supported; reuse the existing ZXing WebAssembly or custom pixel experiment for area frames. An edge view can teach localization, but if candidate coordinates still come from simulation geometry, label that overlay **illustrative candidate location**. For line scans, the current synthetic strip is not a faithful parcel image; first make its displayed strip correspond to the selected parcel's face and label before using it as a processing source. Until that is done, clearly label it **illustrative reconstruction** and keep its decode verdict separate.

For the curated replay, carry the **pixel-decoded observations** through association, deduplication, and finalization, so the displayed parcel values follow from the images shown. Reuse existing association/aggregation rules where their inputs fit. Keep the current analytic live simulation separate; do not combine an analytic success with a pixel no-read to make a single apparent chain.

The source PDF describes static masks, parcel ROI, optional perspective correction of a found barcode, and ZXing C++ decoding. Grayscale, contrast normalization, and edge detection are reasonable additions to the teaching sequence, subject to testing against synthetic sample images. Do not present them as required steps in the source design or claim real-camera performance.

## Python/OpenCV image pipeline

Use Python with OpenCV to build the replay assets **offline**. Export canonical raw area frames and parcel-face line-scan rows from a deterministic scene/capture, then run a script under `scripts/` that generates the exact stage images the UI displays: masked/cropped image, grayscale and contrast view, Canny or gradient edge map, candidate overlay, and perspective-corrected barcode crop. The script should also emit a JSON manifest with parcel ID, capture ID, camera ID, encoder/time interval, source image, processing parameters, candidate coordinates, decoder input crop, and output image paths. The browser reads that manifest and animates the saved stages; Python need not run while someone views the site.

Make candidate detection an explicit tested step on the two curated examples. An OpenCV contour/geometry candidate can be shown as “detected” only if it actually comes from those pixels. If the sample needs a manually supplied or geometry-derived candidate, the overlay must say so. Decode the resulting crop with the existing ZXing WebAssembly path (or a tested equivalent) and put **that** value into the replay's parcel result.

OpenCV is not installed in the current Python environments. Add a small, reproducible Python dependency file when implementation begins, then regenerate and review the stage images as part of the build workflow. The guided replay uses these generated assets; the separate Live Processing module uses a runtime processor described below.

## Separate Live Processing module

Place a **Guided Replay / Live Processing** switch within the single How It Works page. Guided Replay remains the paced explanation above. Live Processing follows the running synthetic station and shows what is happening to the **latest selected capture**. It is a separate UI and processing module with its own state, not a second copy of the storyboard.

### Live screen

- Camera selector: top line scan, bottom line scan, or any of the six side 2D cameras. Show the selected camera and parcel ID prominently.
- Live comparison grid: **raw image**, **masked/ROI image**, **grayscale/contrast**, **edge map**, **candidate/rectified crop**, and **decode**. Each tile carries the same capture ID and capture time or encoder interval.
- A compact event strip shows capture → preprocessing → candidate → decode → parcel association → final result, including no-read reasons. Highlight the matching sensor in the 3D station.
- Pause/freeze holds the complete set of tiles for one capture; resume follows the newest one. Let the viewer inspect the last few processed captures without stopping the conveyor. Display processing lag and dropped preview frames so “live” remains honest.

### Processing boundary

Add a `src/live-processing/` module that receives immutable capture records from the existing camera pipeline. It should expose one result contract for both sensor types: capture ID, parcel ID if known, camera ID, source type (`AREA_FRAME` or `LINE_STRIP`), time/encoder span, named stage images, candidate coordinates, decoded payload or reason, and processing duration. The UI renders that contract and does not run image filters inside React components.

For the local live demo, use a small **Python/OpenCV processor service** under `services/live_processing/`. The browser sends only the selected camera's newest frame or completed strip; the service returns stage previews and candidate metadata from that exact input. Decode the returned crop through the existing ZXing path, then associate the resulting observation to the parcel. Keep at most one processing request in flight per selected camera and replace queued old previews with the newest capture. Limit preview resolution and update rate independently from acquisition, so rendering stays responsive. A line strip can show its row-by-row buildup locally, then run full processing when the strip closes.

“Live” here means live processing of the demo's **synthetic camera output**. It does not imply a connection to physical cameras. The service must never substitute a precomputed guided-replay image for a live capture. If the service is unavailable, say that Live Processing is unavailable while Guided Replay remains usable. The present display-only line-strip texture is insufficient as a live processing source; first make it image the selected parcel's actual face and label, or mark its processing tiles illustrative until that work is complete.

## Implementation order

1. **Lock the story data.** Define one replay manifest format containing parcel ID, pose/encoder position, sensor and capture IDs, raw pixels, intermediate images, candidates, pixel-decoded reads, and final result. Add two deterministic fixtures: successful read and no-read.
2. **Unify the page.** Make `#/how-it-works` the default route; replace the 11 text cards and static `ProcessDiagram` with the storyboard timeline and synchronized 3D/image panels. Remove the four other routes from navigation after their needed visuals are incorporated.
3. **Build acquisition views.** Reuse `SceneCanvas`/station geometry for the system perspective. Add a sensor viewpoint and line-by-line strip animation synchronized to encoder movement. Reuse rendered area frames for the 2D perspective.
4. **Build inspectable image stages.** Add a Python/OpenCV generator for raw, mask/crop, adjusted grayscale, edge map, candidate overlay, and rectified crop assets plus the manifest. Keep display previews small and retain the full-resolution crop needed for decode.
5. **Connect replay results.** Run pixel decode on the selected capture, then associate and deduplicate **those decoded observations** for the selected parcel. Keep the source/mode label visible if an analytic comparison is offered.
6. **Build Live Processing separately.** Add the typed capture/result contract, the Python/OpenCV processor service, the browser client with a bounded newest-capture queue, and the live grid/event strip. Start with one selected side camera, then add all six and the two line scanners once their strip pixels are faithful.
7. **Simplify and verify.** Remove obsolete page components/styles and update the README. Check that every replay step can be revisited, each live tile belongs to the selected capture, six side cameras and both line scanners are represented, and a failure produces no fabricated value.

Likely touch points: `src/App.tsx`, `src/app/layout.tsx`, `src/ui/views/howItWorksView.tsx`, `src/ui/process/*`, `src/scene/sceneCanvas.tsx`, `src/capture/stripPreview.ts`, `src/ui/lab/decoderComparison.tsx`, `src/pipeline/pixelDecoder.ts`, `src/pipeline/zxingDecoder.ts`, `src/styles/global.css`, a new `scripts/` image generator, `src/live-processing/`, `services/live_processing/`, and a Python dependency file.

## Acceptance criteria

- From a fresh load, a viewer can follow one parcel from entrance to final values without visiting another route.
- At any step, the 3D highlight, camera image, processing image, and parcel ID refer to the same replay time and capture.
- The line-scan animation visibly builds a 2D strip from successive cross-belt rows; the 2D sequence visibly transforms one camera frame.
- Edge maps are presented as image features; candidate selection and decode show their actual source or an explicit illustrative label.
- Final values show which sensor observed them, why a duplicate was merged, and why a failed read did not produce a value.
- Regenerating the assets from the same fixture produces the same manifest and stage images; the final parcel result can be traced to the displayed pixel-decoded observations.
- In Live Processing, every visible stage tile comes from the same recent capture; pause freezes all tiles together, and a failed or delayed processor never shows a stale result as current.
- Switching cameras changes the raw feed and all derived stages together. The live result identifies whether it came from an area frame or a completed line strip.
- Replay, keyboard controls, reduced motion, and a readable non-WebGL fallback work on desktop and narrow screens.

OpenCV references: [Python image processing overview](https://docs.opencv.org/4.13.0/d2/d96/tutorial_py_table_of_contents_imgproc.html), [Canny edge output](https://docs.opencv.org/4.13.0/dd/d1a/group__imgproc__feature.html), and [perspective transforms](https://docs.opencv.org/4.13.0/da/d6e/tutorial_py_geometric_transformations.html).
