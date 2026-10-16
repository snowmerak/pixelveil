import { mosaicRegion } from '../helpers/mosaic';
import { detectionLatencyWindowSize, summarizeDetectionLatencies } from '../helpers/detectionLatency';
import type { DetectionLatencyStatistics } from '../helpers/detectionLatency';
import type { Processor } from './Processor';
import { getJevTraceId } from './jevClient';
import type { FrameDetector, NormalizedBox } from './jevClient';

export class JevProcessor implements Processor {
  private object = '';
  private generation = 0;
  private boxes: NormalizedBox[] = [];
  private hasDetection = false;
  private pending: AbortController | null = null;
  private failure: Error | null = null;
  private width = 0;
  private height = 0;
  private readonly detectionLatencies: number[] = [];
  private detectionLatencyStatistics: DetectionLatencyStatistics | null = null;
  private readonly latencyListeners = new Set<() => void>();
  private readonly detect: FrameDetector;
  private readonly blockSize: number;

  constructor(detect: FrameDetector, blockSize = 12) {
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

    if (!this.pending) {
      const controller = new AbortController();
      const generation = this.generation;
      this.pending = controller;
      void this.request(inputFrame, description, controller, generation);
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
    this.failure = null;
    this.object = '';
    this.width = 0;
    this.height = 0;
    this.setDetectionLatency(null);
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

  private async request(frame: ImageData, object: string, controller: AbortController, generation: number) {
    const startedAt = performance.now();
    try {
      const boxes = await this.detect(frame, object, controller.signal, this.hasDetection ? this.boxes.length : undefined);
      if (generation === this.generation && !controller.signal.aborted) {
        this.boxes = boxes;
        this.hasDetection = true;
        const detectionLatencyMs = performance.now() - startedAt;
        this.setDetectionLatency(detectionLatencyMs);
        console.info('[Pixelveil][Jev] boxes_applied', {
          traceId: getJevTraceId(controller.signal),
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
        });
      }
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) {
        this.failure = error instanceof Error ? error : new Error('Jev detection failed.');
      }
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
