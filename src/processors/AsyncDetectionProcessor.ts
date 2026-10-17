import { mosaicRegion } from '../helpers/mosaic';
import { recordDetectionDiagnostic } from '../helpers/jevDiagnostics';
import { detectionLatencyWindowSize, summarizeDetectionLatencies } from '../helpers/detectionLatency';
import type { DetectionLatencyStatistics } from '../helpers/detectionLatency';
import type { Processor } from './Processor';
import { getDetectionTraceId } from './FrameDetector';
import type { FrameDetector, NormalizedBox } from './FrameDetector';
import type { FrameGate, FrameGateStatistics } from './FrameGate';
import { MotionTracker } from '../tracking/MotionTracker';
import type { TrackingStatistics } from '../tracking/MotionTracker';

interface CapturedFrame {
  id: number;
  capturedAtMs: number;
  image: ImageData;
}

export class AsyncDetectionProcessor implements Processor {
  private object = '';
  private generation = 0;
  private boxes: NormalizedBox[] = [];
  private hasDetection = false;
  private previousDetectionCount = 0;
  private frameId = 0;
  private trackingEnabled = true;
  private lastHeldBoxes = 0;
  private pending: AbortController | null = null;
  private failure: Error | null = null;
  private width = 0;
  private height = 0;
  private readonly detectionLatencies: number[] = [];
  private detectionLatencyStatistics: DetectionLatencyStatistics | null = null;
  private readonly latencyListeners = new Set<() => void>();
  private readonly detect: FrameDetector;
  private readonly blockSize: number;
  private frameGate: FrameGate | null = null;
  private unsubscribeGate: (() => void) | null = null;
  private readonly tracker = new MotionTracker(() => this.latencyListeners.forEach((listener) => listener()));

  constructor(
    detect: FrameDetector,
    blockSize = 12,
    private readonly provider = 'Jev',
    private readonly diagnosticContext: Record<string, unknown> = {},
  ) {
    if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
      throw new RangeError('blockSize must be a positive safe integer.');
    }
    this.detect = detect;
    this.blockSize = blockSize;
  }

  process(inputFrame: ImageData, object: string): ImageData {
    const description = object.trim();
    if (description !== this.object || inputFrame.width !== this.width || inputFrame.height !== this.height) {
      this.reset();
      this.object = description;
      this.width = inputFrame.width;
      this.height = inputFrame.height;
    }
    if (!description) return inputFrame;
    if (this.failure) throw this.failure;

    const frameId = ++this.frameId;
    const capturedAtMs = performance.now();
    if (this.trackingEnabled) {
      this.tracker.advance(inputFrame, frameId, capturedAtMs);
      this.boxes = this.tracker.getBoxes();
      const tracking = this.tracker.getStatistics();
      if (tracking.heldBoxes > this.lastHeldBoxes) {
        recordDetectionDiagnostic({
          event: 'tracking_lost', provider: this.provider, ...this.diagnosticContext,
          frameId, detectionFrameId: tracking.detectionFrameId, heldBoxes: tracking.heldBoxes,
          reason: 'motion_unreliable_holding_last_coordinates',
        });
      }
      this.lastHeldBoxes = tracking.heldBoxes;
    }

    if (!this.pending) {
      const controller = new AbortController();
      const generation = this.generation;
      this.pending = controller;
      void this.request({ id: frameId, capturedAtMs, image: inputFrame }, description, controller, generation);
    }

    return mosaicRegion(inputFrame, this.boxes.map((box) => ({
      x: box.left * inputFrame.width,
      y: box.top * inputFrame.height,
      width: (box.right - box.left) * inputFrame.width,
      height: (box.bottom - box.top) * inputFrame.height,
    })), this.blockSize);
  }

  reset(): void {
    this.generation++;
    this.pending?.abort();
    this.boxes = [];
    this.hasDetection = false;
    this.previousDetectionCount = 0;
    this.lastHeldBoxes = 0;
    this.failure = null;
    this.object = '';
    this.width = 0;
    this.height = 0;
    this.frameGate?.reset();
    this.tracker.reset();
    this.setDetectionLatency(null);
  }

  setFrameGate(gate: FrameGate | null): void {
    if (this.frameGate === gate) return;
    this.reset();
    this.unsubscribeGate?.();
    this.frameGate = gate;
    this.unsubscribeGate = gate?.subscribe(() => this.latencyListeners.forEach((listener) => listener())) ?? null;
    this.latencyListeners.forEach((listener) => listener());
  }

  getFrameGateStatistics(): FrameGateStatistics | null {
    return this.frameGate?.getStatistics() ?? null;
  }

  setTrackingEnabled(enabled: boolean): void {
    if (this.trackingEnabled === enabled) return;
    this.reset();
    this.trackingEnabled = enabled;
    this.latencyListeners.forEach((listener) => listener());
  }

  getTrackingStatistics(): TrackingStatistics | null {
    return this.trackingEnabled ? this.tracker.getStatistics() : null;
  }

  getDetectionLatencyMs(): number | null {
    return this.detectionLatencyStatistics?.latestMs ?? null;
  }

  getDetectionLatencyStatistics(): DetectionLatencyStatistics | null {
    return this.detectionLatencyStatistics;
  }

  subscribeDetectionLatency(listener: () => void): () => void {
    this.latencyListeners.add(listener);
    return () => { this.latencyListeners.delete(listener); };
  }

  protected isRecoverableError(error: unknown): boolean {
    void error;
    return false;
  }

  private setDetectionLatency(latencyMs: number | null): void {
    if (latencyMs === null) {
      if (this.detectionLatencyStatistics === null) return;
      this.detectionLatencies.length = 0;
      this.detectionLatencyStatistics = null;
    } else {
      this.detectionLatencies.push(latencyMs);
      if (this.detectionLatencies.length > detectionLatencyWindowSize) this.detectionLatencies.shift();
      this.detectionLatencyStatistics = summarizeDetectionLatencies(this.detectionLatencies);
    }
    this.latencyListeners.forEach((listener) => listener());
  }

  private async request(source: CapturedFrame, object: string, controller: AbortController, generation: number) {
    const startedAt = performance.now();
    try {
      const detectionFrame = new ImageData(new Uint8ClampedArray(source.image.data), source.image.width, source.image.height);
      source.image = detectionFrame;
      const frame = detectionFrame;
      if (this.frameGate) {
        let passed: boolean;
        try {
          passed = await this.frameGate.check(detectionFrame, object, controller.signal);
        } catch {
          return;
        }
        if (generation !== this.generation || controller.signal.aborted) return;
        if (!passed) {
          this.boxes = [];
          this.previousDetectionCount = 0;
          this.tracker.clear();
          recordDetectionDiagnostic({
            event: 'frame_skipped', provider: this.provider, ...this.diagnosticContext,
            traceId: getDetectionTraceId(controller.signal), reason: 'embedding_below_threshold',
            latencyMs: performance.now() - startedAt, boxCount: 0,
            sourceFrameId: source.id, sourceCapturedAtMs: source.capturedAtMs, currentFrameId: this.frameId,
          });
          return;
        }
      }
      const detectedBoxes = await this.detect(detectionFrame, object, controller.signal, this.hasDetection ? this.previousDetectionCount : undefined);
      if (generation === this.generation && !controller.signal.aborted) {
        const detectorLatencyMs = performance.now() - startedAt;
        const correction = this.trackingEnabled ? await this.tracker.correct(source.id, detectedBoxes, controller.signal) : null;
        if (generation !== this.generation || controller.signal.aborted) return;
        this.boxes = this.trackingEnabled ? this.tracker.getBoxes() : detectedBoxes;
        const boxes = this.boxes;
        this.hasDetection = true;
        this.previousDetectionCount = detectedBoxes.length;
        const detectionLatencyMs = performance.now() - startedAt;
        this.setDetectionLatency(detectionLatencyMs);
        const diagnostic = {
          ...this.diagnosticContext,
          provider: this.provider,
          traceId: getDetectionTraceId(controller.signal),
          sourceFrameId: source.id,
          sourceCapturedAtMs: source.capturedAtMs,
          appliedFrameId: correction ? correction.appliedFrameId : this.frameId,
          detectorLatencyMs,
          trackingCorrection: correction,
          detectedBoxCount: detectedBoxes.length,
          detectedBoxes: detectedBoxes.map((box) => ({ ...box })),
          frameWidth: frame.width,
          frameHeight: frame.height,
          boxCount: boxes.length,
          detectionLatencyMs: Math.round(detectionLatencyMs),
          latencyStatistics: this.detectionLatencyStatistics,
          boxes: boxes.map((box) => ({ ...box })),
          pixelBoxes: boxes.map((box) => ({
            x: box.left * frame.width,
            y: box.top * frame.height,
            width: (box.right - box.left) * frame.width,
            height: (box.bottom - box.top) * frame.height,
          })),
        };
        const event = correction && correction.status !== 'applied' ? 'detection_not_applied' : 'boxes_applied';
        recordDetectionDiagnostic({ event, ...diagnostic });
        console.info(`[Pixelveil][${this.provider}] ${event}`, diagnostic);
      }
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted && !this.isRecoverableError(error)) {
        this.failure = error instanceof Error ? error : new Error(`${this.provider} detection failed.`);
      }
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
