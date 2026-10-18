# Pixelveil

A webcam frame-processing lab built with Vite, React, and TypeScript. The UI uses CSS and tokens from `merak-protocol-design-system`.

The UI defaults to English, with Korean available through the language selector in the header. The selected language is saved in local storage and persists across reloads. UI translations live in `src/i18n.ts`; localized processor descriptions are defined in the registry.

## Getting started

Use Node.js 22.13 or later within the 22.x series, or Node.js 24 or later, and pnpm 10.28.1.

`pnpm-workspace.yaml` installs native dependencies for both the current architecture and ARM64 so builds also work on Windows ARM when pnpm and Node.js run under different architectures.

```sh
pnpm install
pnpm dev
```

Open the localhost URL printed in the terminal, click **Start camera**, and allow camera access. The original and processed views appear side by side, or vertically on narrow screens. Camera access requires localhost or HTTPS.

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

## Configuration

Dummy works without external services. Jev requires a TypeSafe API key, and VLM requires an image-capable OpenAI-compatible Chat Completions server. The optional embedding pre-check was implemented using [snowmerak/oev](https://github.com/snowmerak/oev) with EmbeddingGemma2 and expects its multimodal embedding API contract, described below. These services and their models are not installed or started by Pixelveil.

Copy `.env.example` to `.env.local`, then replace service addresses, model IDs, and credentials with values for your environment. Explicitly configure the services you intend to use.

For example, the following assumes a VLM server on the same machine at port 1234 and an embedding server at port 8001. These addresses and ports are examples, not application defaults. Replace the API-key and embedding-model placeholders before using those services; optional keys can remain empty if the servers do not require authentication.

```dotenv
TYPESAFE_API_KEY=your-typesafe-api-key
JEV_TIMEOUT_MS=30000
VLM_BASE_URL=http://localhost:1234/v1
VLM_API_KEY=
VLM_TIMEOUT_MS=120000
EMBEDDING_BASE_URL=http://localhost:8001/v1
EMBEDDING_MODEL=your-multimodal-embedding-model-id
EMBEDDING_API_KEY=
EMBEDDING_TIMEOUT_MS=30000
```

For services on another machine, use a hostname or address reachable from the machine running Vite; `localhost` refers to the Vite server's machine, not necessarily the browser's. Base URLs include the API prefix, such as `/v1`, but not `/chat/completions` or `/embeddings`. All timeout values are milliseconds.

These variables are server-side settings; do not add a `VITE_` prefix to secrets. Values are loaded at Vite startup, with process environment variables taking precedence over environment-file values. Restart Vite after changing them. The browser calls same-origin `/api/jev`, `/api/vlm`, and `/api/embedding` routes, not the configured upstream addresses directly. A static-only deployment must supply equivalent server proxies.

## Project structure

- `src/processors/Processor.ts`: the `process(inputFrame: ImageData, object: string): ImageData` interface
- `src/processors/Dummy.ts`: the default implementation, which returns the input frame unchanged
- `src/processors/AsyncDetectionProcessor.ts`: detection-frame dropping, source-frame preservation, tracking and detection cycles, and cancellation state
- `src/processors/JevProcessor.ts`: shared base class for Jev processors
- `src/tracking/`: CPU-based sparse optical flow, source-frame history, delayed detection correction, and live tracking
- `src/processors/JevSimple.ts`: single-object detection processor
- `src/processors/JevScroll.ts`: detection processor for up to six objects
- `src/processors/JevPanning.ts`: experimental processor using six fixed Box queries and all-zero responses for empty slots
- `src/processors/jevClient.ts`: image encoding, Choice, Box, and presence queries, and response validation
- `server/jevProxy.ts`: TypeSafe API proxy for the development and preview servers
- `src/processors/registry.ts`: processor names, descriptions, and factory functions shown in the UI
- `src/helpers/`: frame-processing helpers, including bbox-region mosaicing
- `src/hooks/useWebcamProcessor.ts`: camera-stream lifecycle and frame-processing loop
- `src/components/FrameCanvas.tsx`: original and processed frame canvases
- `src/App.tsx`: processor selection and camera controls

## Adding a processor

1. Add a class implementing `Processor` under `src/processors/`.
2. Register a unique `id`, `label`, `description`, and `create` function in `processorDefinitions`.
3. Add controls to the processor settings area when an algorithm has adjustable parameters. Setting `requiresObject: true` displays the target-description input.

The frame pipeline is `video → original canvas → ImageData → Processor.process → output canvas`. Input frames are RGBA `ImageData`, and the default `Dummy` returns the same object. Processors are synchronous and may mutate the input or return an `ImageData` with different dimensions. The original canvas is drawn before processing, so mutating the input object does not affect the original view.

The second argument to `process`, `object`, is a string. `useWebcamProcessor(processor, object)` passes the current target-description value with each frame. Changes take effect on the next processing pass without restarting the camera stream. `Dummy` does not use this argument.

Selecting a processor creates a new instance for subsequent frames while keeping the camera stream running. Stopping the camera or unmounting the component cleans up stream tracks and the rendering loop; the optional `reset()` method clears in-flight processor work and caches. Mosaicing runs on the browser's main thread. `Dummy` sends no frames externally; Jev processors send detection frames to TypeSafe.

## Jev · Simple decision

1. Follow [Configuration](#configuration) and set `TYPESAFE_API_KEY` in `.env.local` to your actual key. The key is read only by the server; do not give it a `VITE_` prefix.
2. Run `pnpm dev`, or run `pnpm build` followed by `pnpm preview`.
3. Select **Jev · Simple decision**, enter a description in **Object to mosaic**, and start the camera.

`process` synchronously returns the current frame. Only when no detection is in flight does it encode a copy of the original frame as PNG and send a request. Additional frames arriving during encoding, upload, or response waiting are dropped as detection inputs, with no separate request queue. Motion tracking is enabled by default and continues using these frames to move the boxes. Response boxes are advanced from their detection source frame to the current frame before being applied. The next incoming frame starts the next request. With tracking disabled, the latest detected coordinates remain fixed between detections.

Changing the target description or frame dimensions, stopping the camera, switching processors, or unmounting clears caches and cancels the existing request. Generation numbers prevent stale responses and errors from being applied even if cancellation is delayed. The same instance does not start another request until the cancelled work finishes.

- The model is `jev-preview`. Each request combines one Box query with a Noul presence query. Only valid boxes with presence probability at least `0.5` and Box confidence at least `0.15` are accepted. If either is below its threshold, the cache is cleared. Boundary values are included. These are PoC default thresholds. A box whose presence query passes must have a finite confidence value in the range 0–1; missing or invalid confidence is a response error.
- Normalized coordinates from the [official Box documentation](https://docs.typesafe.ai/primitives/box) are converted to pixel bboxes for the current frame. Each image dimension is adjusted to 280–1568 pixels to match the [image requirements](https://docs.typesafe.ai/images). Small images or extreme aspect ratios may be distorted, but normalized coordinates remain relative to the entire frame.
- Frames are captured before mosaicing. Frames not selected for a request undergo no additional full-frame copying, PNG encoding, or upload.
- The original frame is shown before the first detection or when the target description is empty. If tracking fails or is disabled, boxes remain at their last coordinates between detections. Fast-motion tracking and complete concealment are not guaranteed.
- A failure is propagated on the next `process` call and stops the camera. After resolving the problem, start the camera again to retry. There is no automatic retry.
- `JEV_TIMEOUT_MS` is the server request timeout, defaulting to 30000 ms. Restart Vite after changing environment values.
- `/api/jev` is provided by the Vite development and preview servers. Deploying only the static `dist` directory requires a separate server proxy at the same path.

## Jev · Scroll decision

With the same API-key configuration, select **Jev · Scroll decision** and enter the target description. Each detection cycle works as follows:

1. Encode the original frame as PNG once.
2. **On the first cycle only**, use a [Choice query](https://docs.typesafe.ai/primitives/choice) to select `0 / 1 / 2 / 3 / 4 / 5 / 6 or more` objects. A result of `0` clears the bbox cache and ends the cycle. Otherwise, query the selected number of boxes using the same PNG.
3. **From the next cycle onward, skip Choice** and request `min(previous valid bbox count + 1, 6)` boxes in one request. The same request includes a Noul query checking whether the object at each position actually exists. Each query targets the Nth object ordered top to bottom by its top edge, with ties broken left to right by its left edge. The prompt does not assert that the requested number is the actual total.
4. Accept only valid boxes with per-position presence probability at least `0.2` and Box confidence at least `0.1`, and use their count as the basis for the next cycle. Boundary values are included. For example, after two valid detections, request three boxes; if only one passes the filters, request two next time. Even after the count drops to zero, subsequent cycles query one slot, allowing objects to reappear.
5. Validate the entire response before updating the valid detection count for the next cycle. With tracking enabled, replace the displayed bbox set only after successfully advancing it to the current frame. If correction is rejected, use the new valid detection count for the next request while retaining the existing displayed tracks. With tracking disabled, replace the bbox set directly with the validated result. Missing required presence answers, invalid coordinates or missing/invalid confidence for slots whose presence query passes, and request failures are errors; boxes are not partially applied. Ignore Box answers for absent slots. Exclusion for low confidence is not an error. If every box is excluded, clear the cache and record a successful detection-latency sample.

Additional frames are dropped as detection inputs throughout the cycle, from encoding through the final response. The first cycle uses up to two HTTP requests; later cycles use one. Rendering continues with the previous cycle's boxes. A new frame arriving after the response starts the next cycle. Changing the target or frame size, stopping the camera, or switching processors also resets the previous count, so the next cycle starts with Choice again. Cancelled-cycle responses do not affect boxes, counts, or latency measurements.

Box has no “not found” response, so the number of Box answers alone cannot represent the actual object count. The valid count here means boxes passing per-position Noul, coordinate validation, and confidence filtering; it does not guarantee the true count. This PoC experiments with the model's presence and ordering judgments. It does not guarantee detection of every distinct object or avoidance of duplicate boxes. The search count can grow by only one per cycle, up to six. Key configuration, proxy, timeouts, and the original view before the first detection follow Simple decision. The timeout applies separately to each HTTP request.

## Jev · Panning decision

With the same API-key configuration, select **Jev · Panning decision** and enter the target description. Starting with the first cycle, encode PNG once and send **six Box queries, `target_1` through `target_6`, and one Noul query in the same HTTP request**. Noul `present` asks **whether at least one matching object is visible in this image**, not how many objects exist or whether an Nth object exists. If overall presence probability is below `0.5`, ignore all boxes and clear the cache. At `0.5` or above, apply the Box filters below. Missing or invalid Noul answers are errors. There is no separate presence-check round trip or Choice query; six boxes are always requested, regardless of the previous detection count. This does not tile the image: it targets distinct objects using the same top-to-bottom, then left-to-right ordering as Scroll.

Each query requests the tightest box around its single indexed object and instructs the model to return `{ left: 0, top: 0, right: 0, bottom: 0 }` when that position does not exist. A Box with all four coordinates equal to numeric `0` is excluded as an empty slot. **Panning does not use Box confidence as an acceptance condition.** Confidence is logged only for analysis; candidates with valid coordinates are considered even if confidence is missing. Simple's `0.15` and Scroll's `0.1` confidence thresholds remain unchanged.

Valid candidates are considered in ascending area order. Larger boxes overlapping an already selected smaller box with positive area are discarded. Non-overlapping candidates are kept regardless of size. Equal-area ties favor the earlier slot, and touching edges or corners do not count as overlap. If one large box encloses two separate smaller boxes, only the large box is removed. This is a greedy smaller-area-first selection: a candidate overlapping only discarded boxes, but no selected box, is retained. Final output preserves the original slot order.

Valid boxes touching the top or left image boundary (`top=0` or `left=0`) are retained. If all six slots are all-zero boxes, the cache is cleared. Missing answers, invalid types, out-of-range coordinates, and zero-width or zero-height boxes other than the all-zero sentinel are errors; results are not partially applied. Confidence does not affect coordinate validation or overlap selection.

The all-zero rule is **an experimental project prompt convention, not the API's official “not found” response**. The [official Box documentation](https://docs.typesafe.ai/primitives/box) states that a box is always returned and valid coordinates satisfy `left < right` and `top < bottom`. If the model or API does not follow the all-zero instruction, nonexistent objects may still produce boxes. Overall presence checking filters boxes when no matching object exists; finding one object does not establish that all six slots exist. Boxes for genuinely different objects may suppress one another if they overlap, while large false detections not overlapping a smaller candidate may remain. No per-slot Noul, coordinate repair, or follow-up queries are added. Actual object presence, individual-object separation accuracy, and latency improvements are not guaranteed.

Frame dropping, retention of previous boxes, cancellation, resets, and error handling follow the other Jev processors. The same latency panel and p50/p90/p99 statistics apply. Each Box row in the response log shows the same overall presence probability (`presence`) and threshold `0.5` (`presenceThreshold`), with `confidenceThreshold` set to `null`. When presence is below the threshold, every slot has `disposition: absent`. Otherwise, all-zero slots are `zero_box`, candidates suppressed by overlap with a selected smaller box are `overlap_suppressed`, and selected candidates are `accepted`. Absence, all-zero slots, and overlap suppression are not request failures; those cycles are included in successful detection-latency statistics.

## VLM · Simple detection

This processor shares Jev's asynchronous frame-processing flow but replaces the detection API with OpenAI-compatible Chat Completions. Select **VLM · Simple detection** to choose among the model IDs currently allowed by the application:

- `qwen3-vl-reap-24b-a3b` (initial UI selection)
- `qwen3.6-35b-a3b-ud-mlx`
- `gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp`
- `minicpm-v-4.7-1b@f16`

These are server-facing model IDs, not a guarantee that the models are installed or available. Your server must expose the exact selected ID. To use a different model ID or server alias, update the shared `vlmModels` allowlist in `src/processors/vlmProtocol.ts`; changing `VLM_BASE_URL` alone does not allow arbitrary model IDs. The server must support image inputs and the structured-output request used below.

Set `VLM_BASE_URL` to your server's API base URL as shown in [Configuration](#configuration). `VLM_API_KEY` is optional, and `VLM_TIMEOUT_MS` defaults to 120000 ms. The URL and key are used only by the Vite server; do not use a `VITE_` prefix. Environment values are validated at startup, and changes require restarting Vite. Models can be changed immediately through the UI; switching resets in-flight requests, boxes, and statistics. A request uses the model selected when it began, and late responses from the previous model are not applied.

1. Resize the original frame to fit within `1280×720` and encode it as PNG, preserving aspect ratio without upscaling, cropping, or padding.
2. The browser sends the model, target description, and PNG to the same-origin `/api/vlm` endpoint. The server forwards them to its configured `/chat/completions` endpoint. Only the models listed above are allowed; the browser cannot provide arbitrary URLs, prompts, or generation options.
3. Use `temperature: 0`, `max_tokens: 1024`, `stream: false`, and a strict JSON Schema. Request an independent tight bbox for each object, up to 20 boxes, or `{"boxes":[]}` when none exist. Coordinates must be integers from `0–1000`; after validating positive width and height, normalize them to `0–1` for mosaicing the original frame. No additional confidence, presence-probability, or overlap filters are applied.
4. Frames arriving during detection are dropped as detection inputs, while the latest boxes continue to be applied to the displayed frames. An empty array clears the box cache. The original frame is shown before the first detection; reliable motion tracking and complete concealment are not guaranteed.
5. The response's `finish_reason` must be `stop`, and the entire `message.content` is validated as JSON. Boxes with invalid coordinates or non-positive width or height are skipped, with `vlm_box_rejected` warnings containing coordinates, zero-based array index, and rejection reason. Valid boxes from the same response are accepted. If every box is invalid, the JSON or response format is invalid, or output is truncated, `vlm_error` records `recoverable: true` and the reason. Previous boxes are retained, and a new detection starts on a subsequent frame. These errors neither add successful latency samples nor stop the camera. A valid `{"boxes":[]}` still clears the cache. HTTP, network, and encoding failures still stop the camera. When using LM Studio with Qwen3.6, empty content may require disabling thinking in the model's chat template; request options alone should not be assumed to disable it. Other servers may require different model-template or reasoning settings.

This processor uses the same latency and p50/p90/p99 panel as Jev. Total detection latency includes copying the original frame, any enabled embedding pre-check, resizing and encoding, API response validation, and completion or rejection of catch-up when tracking is enabled. See Detection latency below for measurement boundaries. The `[Pixelveil][VLM]` console logs and **Export logs** button expose response boxes, applied boxes, model, and latency. VLM events include `provider: "VLM"` and `model`; `traceId` links events from the same detection cycle. Images, target descriptions, and credentials are not logged. Jev and VLM share the most recent 3,000-event buffer. Exports containing VLM events are named `pixelveil-detection-<UTC timestamp>.json`.

`/api/vlm` is also provided only by the Vite development and preview servers. A static-only `dist` deployment needs a separate server proxy. `VlmProcessor` and `JevProcessor` share frame dropping, box caching, cancellation, and statistics through `AsyncDetectionProcessor`.

## Embedding pre-check

This integration was implemented and tested with [snowmerak/oev](https://github.com/snowmerak/oev), serving EmbeddingGemma2 under the local model alias `embeddinggemma2`. The alias is a deployment setting, not a universal model identifier. See [oev's embedding documentation](https://github.com/snowmerak/oev#embeddings) for server setup and model configuration.

The model-discovery metadata, image-input format, and query-prefix option described here are part of the oev integration. This is not a claim of compatibility with every OpenAI-style embeddings endpoint. Changing the host address does not remove these API requirements; another server needs an equivalent contract or an adapter.

After selecting Jev or VLM, enable **Use embedding pre-check** to compare the cosine similarity of the target description and frame before bbox detection. It is disabled by default. **Cosine similarity threshold** can be adjusted immediately within `-1–1`. The default `0.65` is an uncalibrated experimental starting point, not an object-presence probability or a validated optimal threshold. Evaluate actual scores for each target and background. Small objects may contribute little to the whole-image embedding and can be missed.

1. Request a text embedding for the target description through `/api/embedding` using `input_type: query`, and cache it in memory. It is not saved to disk or localStorage.
2. Copy the original detection frame, resize it to fit within `320×320` while preserving aspect ratio, encode it as PNG, and request its image embedding. A 720p input becomes `320×180`. The bbox detector receives the same original, pre-mosaic copy.
3. Normalize both vectors from the same model with the same dimensions and compute cosine similarity. Call the existing bbox detector only when `score >= threshold`. Below the threshold, skip the bbox request and clear the previous box cache.
4. Process only one cycle at a time, from embedding through bbox detection, and drop incoming frames as detection inputs while waiting. Rendering continues with the existing boxes. Embedding-server errors or invalid vectors are not treated as object absence: retain the previous boxes and retry on a subsequent frame. Errors are logged without stopping the camera.

Set `EMBEDDING_BASE_URL` to your oev server's API base URL and `EMBEDDING_MODEL` to the model's configured `served_model` name, as shown in [Configuration](#configuration). `EMBEDDING_API_KEY` is optional, and `EMBEDDING_TIMEOUT_MS` defaults to 30000 ms. The implementation's fallback model ID is the `embeddinggemma2` alias used in the tested deployment; Pixelveil does not install its checkpoint. An alternative must support both text and images in a shared embedding space and satisfy the oev contract below.

The proxy checks `/models` before the first embedding request. The response must contain a `data` array with an entry whose `id` matches `EMBEDDING_MODEL`, whose `task` is `embedding`, and whose `input_modalities` includes both `text` and `image`. It then posts to `/embeddings` with `model` and `encoding_format: "float"`. Text requests use a string `input` and `input_type: "query"`; image requests use `input: { image: <PNG data URL> }`. Responses must identify the configured model and contain valid embedding vectors. A text-only embedding server or an API using a different image-input or discovery format is not interchangeable without an adapter. The first successful capability check is cached for the lifetime of the Vite process. Restart Vite after environment changes. Keys are server-side only; development and preview expose `/api/embedding`, while static deployments require a separate proxy.

UI changes to enablement, threshold, or model take effect on subsequent frames and reset in-flight requests, target embeddings, boxes, and statistics, just like target/frame-size changes or stopping the camera. Dummy does not run the pre-check. Enabling remote embeddings sends frames to the embedding server even when their bbox requests are skipped. The additional embedding round trip can increase total detection latency when most frames already contain the target.

The statistics panel below the video shows **the embedding pre-check's own latest latency and p50/p90/p99**, text-embedding time (0 ms when cached), frame-encoding and embedding time, vector-comparison time, similarity, and passed/skipped/error counts. Pre-check statistics include successful passed and skipped cycles, excluding errors and cancellations. Total detection-latency statistics include cycles that pass embedding and successfully validate the bbox response; with tracking enabled, elapsed time through catch-up completion or rejection is included too. Cycles skipped by embedding are not included. Both latency windows retain at most 1,000 samples, and p99 is the maximum with fewer than 100 samples. Counters accumulate successful passes, skips, and errors since reset.

JSON exports include `embedding_gate` (score, threshold, pass decision, cache use, stage timings, and statistics), `frame_skipped` (bbox request skipped and boxes removed), and `embedding_error` events. Embedding, bbox responses, and box application in the same cycle share a `traceId`. Images, target descriptions, vectors, and credentials are not logged. Exports containing embedding events are named `pixelveil-detection-<UTC timestamp>.json`.

## Motion tracking between detections

All three Jev strategies and VLM enable **Track motion between detections** by default. Turn it off in the UI to compare against fixed bbox coordinates. Changing this setting replaces the processor and resets existing requests, embedding caches, boxes, and statistics without restarting the camera stream. The `Processor.process(ImageData, object): ImageData` contract is unchanged. **Input and output video always use the current frame; old video frames are not substituted, and rendering does not wait for detection responses.**

Each input frame receives an ID increasing within the processor instance and a browser capture timestamp from `performance.now()`. Detection requests preserve a pre-mosaic copy of the original frame, shared by embedding and bbox detection. Separately, each frame is converted to grayscale at up to `320×240` (`320×180` for 720p input). Source history is limited to **5 seconds, 180 frames, or 16 MiB, whichever is reached first**. At 60 fps, the frame-count limit therefore retains roughly three seconds. Full original RGBA frames are not stored in history. OpenCV builds optical-flow pyramids internally during computation.

- Feature detection and sparse optical flow use OpenCV.js 4.12.0 Shi–Tomasi detection (`cv.goodFeaturesToTrack()`, Harris disabled) and pyramidal LK tracking (`cv.calcOpticalFlowPyrLK()`). The dependency is pinned to `@techstark/opencv-js@4.12.0-release.1`; no custom LK implementation is used. Processing runs on browser CPU/WASM without extra models or WebGPU. Each box has up to 32 feature points. LK uses a 21×21 window, maximum pyramid level 3, and up to 30 iterations. Forward–backward consistency checks and outlier-resistant similarity-transform estimation are custom TypeScript code. Rotated corners are preserved, and an axis-aligned bbox is computed only for output. This avoids geometric inflation caused by repeatedly rotating an already axis-aligned rectangle; it does not prevent cumulative enlargement from estimation errors.
- OpenCV is lazy-loaded as a separate chunk on first use of tracking, with one shared runtime per page. It does not depend on an external CDN and is not loaded for Dummy or when tracking is disabled. Current video continues during loading. Initial loading/initialization failures or a 30-second timeout are first logged to the console. If initialization failure is subsequently propagated while correcting a valid detection response, a processing error stops the camera. Errors are not immediately propagated to the camera when correction is never reached, such as when embedding keeps skipping detection. Failed initialization is not retried within the same page; reload the page, or disable tracking and restart the camera. There is no fallback to custom LK. The 200 ms catch-up limit starts after initialization, while total detection latency includes initialization waiting. Temporary `cv.Mat` objects are deleted in `finally` on both success and failure; history contains only JavaScript grayscale arrays.
- When delayed boxes arrive, initialize features in their source frame and replay the history to the current frame. Existing tracks continue to drive current video during correction. Catch-up yields to the event loop after roughly 6 ms of work and replaces the entire existing track set with the new boxes only after reaching the latest frame within the default 200 ms elapsed-time limit. This is not a limit on a single LK call: it includes feature initialization, tracking across multiple frames, yields, and scheduling waits. Frames arriving during yields must also be caught up, and catch-up shares the main thread with live tracking and rendering. The limit is checked between frame-processing steps, so rejection can occur after more than 200 ms.
- If the source frame has expired from history, features are lost during correction, or the time budget is exceeded, past coordinates are not applied as if they were current. Existing tracks remain, and another detection cycle follows. If even the initial detection cannot be corrected, no new boxes may be available to display.
- If an applied track loses its features or the input-frame interval exceeds 250 ms, **hold its last coordinates** and report tracking loss rather than freezing the video. This is not an object-absence decision and does not guarantee continued concealment of a moving target. Held coordinates have no time-based expiry. A later detection that can be advanced to the current frame reinitializes tracking; empty detections, failed embedding thresholds, and resets remove the tracks.
- Valid empty bbox responses and embedding-threshold failures clear boxes and tracks under the existing policy. Tracking alone therefore does not resolve embedding rejection when only a phone's edge is visible. Scroll's next request count uses the previous valid **detection result count**, not the number of tracking features or displayed boxes.

This combination tracks features; it is not an object-mask or semantic object tracker. Features are selected inside the bbox without separating the target from the background. When fewer than 20 points remain, points are replenished inside the current tracked region. Mixed background, hand, and target motion can produce an incorrect similarity transform or introduce more background points during replenishment. Per-frame scale is limited to `0.75–1.33` and rotation to ±30 degrees, but there is no limit on cumulative scale or region size relative to the initial detection. Drift or abnormal box enlargement can therefore occur without `lost`, and repeated rejection of new detection corrections can leave incorrect tracks active. These are known limitations of the current implementation.

`src/tracking/openCvModule.ts` is an ESM adapter for lazy loading. This OpenCV runtime has its own `then` method, so the runtime or a namespace spreading it is not returned directly as a Promise result; it is wrapped in `{ cv }`. Removing this wrapper and dynamically importing the package directly can cause conflicts between the bundler's CommonJS conversion and Promise handling.

The bottom statistics panel shows tracking status, tracked and held box counts, and per-frame processing time. Expand the details to see tracking p50/p90/p99, the latest processed frame ID, detection source ID, catch-up time, rejected-correction count, and history size. Tracking statistics cover at most the latest 1,000 frames and include history-generation cost while waiting for detection. React subscriptions update approximately every 250 ms or on state transitions, not on every frame. Catch-up cost is displayed separately. Actual webcam performance depends on the device and number of targets.

In JSON logs, `boxes_applied` distinguishes original detections (`detectedBoxes`, `detectedBoxCount`) from corrected output (`boxes`, `pixelBoxes`). `sourceFrameId` and `sourceCapturedAtMs` identify the request frame; `appliedFrameId` identifies the latest processed frame reached by correction. `trackingCorrection` records application status, replayed frame count, and catch-up time. `detectorLatencyMs` covers the original-frame copy, embedding, and detection; `detectionLatencyMs` additionally covers catch-up through completion or rejection. Neither directly measures the camera capture/live-tracking work immediately before the request or the resulting mosaic/output work itself. However, these are elapsed-time measurements: tracking and rendering of other frames during request/correction waits, and event-loop scheduling, affect them. They are not pure API timings or pure LK CPU timings. Rejected coordinate corrections are logged as `detection_not_applied`; transitions to live tracking loss are logged as `tracking_lost`. Not every frame is logged. A cycle with a valid API response rejected during coordinate correction is included in detection-latency samples, but must not be counted as a cycle that applied new boxes.

## Detection latency

The statistics panel at the bottom of the UI shows the latest Jev or VLM detection cycle's total elapsed time in milliseconds (`ms`). It uses normal layout without covering the video: statistics appear side by side on wide screens and vertically on narrow screens. Measurement uses `performance.now()`, starting just before copying the original frame and ending immediately after bbox response validation and, when enabled, completion or rejection of tracking catch-up. It includes any enabled embedding pre-check, resizing, PNG encoding, upload, server proxy, API round trips, and OpenCV initialization waiting in the correction stage. With tracking disabled, measurement ends after bbox response validation. The initial Scroll cycle includes count detection and any required Box request; zero-object responses are also normal completions. Cycles skipped by embedding are not detection-latency samples. This is neither camera-to-display end-to-end latency nor the pure CPU time of individual stages.

The latest completed value remains visible while the next request is in flight. The display shows `—` before the first response, for Dummy, and after target/frame-size changes, camera stop, or processor replacement. Cancelled, failed, or stale-generation responses do not update the measurement. Detection-latency values update through subscriptions only on completion or reset, so measuring them does not trigger per-frame React rendering.

The same panel shows `p50`, `p90`, `p99`, and sample count for the latest **up to 1,000 detection cycles completed with valid API responses**. Once full, the window discards the oldest samples. Each cycle contributes one sample, including zero detections and cycles whose coordinate correction is rejected. Dropped frames, embedding skips, request/response-validation errors, cancellations, and stale-generation responses are excluded. Initial Scroll cycles are included. Statistics are maintained per processor and reset under the same conditions as the latency display. They are not persisted.

Percentiles use nearest rank: sort unrounded millisecond samples in ascending order and select index `ceil(sample count × percentile) - 1`. With no samples, show `—`; with one, all three percentiles equal that sample. For fewer than 100 samples, p99 is the maximum, so the UI warns that the sample is too small for a stable tail-latency estimate. Read the current snapshot through `Processor.getDetectionLatencyStatistics()`. Console `boxes_applied.latencyStatistics` also includes `sampleCount`, `latestMs`, `p50Ms`, `p90Ms`, and `p99Ms`. Console values remain unrounded; only the UI displays integer milliseconds.

## Jev response logs

In the browser developer tools (F12), open **Console** and filter by `[Pixelveil][Jev]`. Logs use the default Info level and appear in the browser console, not the server terminal.

- `response <requestId>` group: expand it to see request duration (`requestLatencyMs`), Choice result (`countChoice`), requested and accepted bbox counts, and a coordinate table. Coordinates are normalized API values (0–1), with `confidence`, per-position presence probability (`presence`), and acceptance thresholds (`confidenceThreshold`, `presenceThreshold`).
- Table `disposition`: `accepted` means the slot passed coordinate validation and the strategy's acceptance rules; `absent` means presence is below `0.5` for Simple/Panning or `0.2` for Scroll; `zero_box` is a Panning all-zero slot; `overlap_suppressed` is a Panning candidate excluded by overlap with a selected smaller box; `low_confidence` means Box confidence is below `0.15` for Simple or `0.1` for Scroll; `invalid` means missing or invalid data; and `ignored_cancelled` identifies a cancelled request's response. An `invalid` slot can fail the whole response, so `accepted` does not imply final application. Panning's `presence` is the overall presence probability shared by all rows, not per-slot presence, and no confidence filter is used.
- `boxes_applied`: normalized coordinates actually applied to the bbox cache (`boxes`), original-frame pixel coordinates (`pixelBoxes`), count (`boxCount`), frame dimensions, and total detection time (`detectionLatencyMs`). Pixel coordinates are recorded before the mosaic helper's rounding and clipping. `traceId` links count/Box responses and application results from the same detection cycle; each HTTP request has a separate `requestId`.
- `response_error` / `invalid_response`: inspect HTTP error statuses or JSON parsing failures.

Logs record events such as responses, errors, detection completion, embedding checks, and transitions to tracking loss. They do not record every frame dropped as a detection input or every frame's feature points. Images, target descriptions, API keys, and authorization headers are not logged; only necessary fields such as coordinates are included.

### JSON export

Use **Export logs** in the bottom statistics panel to download `pixelveil-jev-<UTC timestamp>.json`. The button count is the number of retained events, not detection cycles. `jev_response` contains fully expanded coordinates, confidence, presence, decisions, and thresholds; `boxes_applied` contains applied coordinates, pixel coordinates, and latency statistics. HTTP errors and JSON parsing failures are also retained. Use `traceId` to link a cycle, `requestId` to distinguish HTTP requests, and each event's `sequence` and UTC `timestamp` to determine order.

The page retains **up to the latest 3,000 events** in memory. Older events are discarded when the limit is exceeded; export fields `recordedEventCount` and `droppedEventCount` report total recorded and discarded counts. The buffer can cut through a cycle, so the oldest cycle may be incomplete. Logs survive camera stops and target/processor changes and can be exported after stopping, but disappear on reload or page close. Records previously printed only to the console by older versions cannot be collected retroactively. There is no automatic file saving, server upload, or localStorage persistence. Coordinates and decisions are copied when recorded and are not affected by subsequent object mutations.

## Region mosaic helper

`mosaicRegion(frame, bboxes, blockSize = 12)` accepts an array of bboxes and fills blocks within each region with their average RGB color. It **mutates the input ImageData and returns the same object**, so it can be used directly inside a processor's `process` method. Alpha values and pixels outside every bbox are preserved.

```ts
import { mosaicRegion } from './helpers';
import type { BoundingBox } from './helpers';

const bboxes: BoundingBox[] = [
  { x: 100, y: 80, width: 240, height: 180 },
  { x: 500, y: 120, width: 160, height: 160 },
];
const outputFrame = mosaicRegion(inputFrame, bboxes, 16);
```

- Bboxes use pixel coordinates `{ x, y, width, height }`, with the origin at the frame's top-left corner.
- For fractional coordinates, the top-left corner is rounded down and the bottom-right corner up to include intersected pixels. Areas outside the frame are clipped.
- Blocks start at the clipped bbox's top-left corner. Smaller edge blocks average only their own pixels.
- An empty array returns the frame unchanged. Bboxes with non-positive width/height or no overlap with the frame are skipped; other regions are still processed.
- Regions are processed in array order. Overlapping regions are mosaiced again using the already processed pixels.
- `NaN`/infinite bbox values or a block size that is not a positive safe integer cause a `RangeError` before the frame is changed. A block size of 1 preserves the original pixels.
- To preserve the original object, copy it first, for example: `mosaicRegion(new ImageData(new Uint8ClampedArray(inputFrame.data), inputFrame.width, inputFrame.height, { colorSpace: inputFrame.colorSpace }), bboxes)`.
