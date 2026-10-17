import type { NormalizedBox } from '../processors/FrameDetector';
import { summarizeDetectionLatencies } from '../helpers/detectionLatency';
import type { DetectionLatencyStatistics } from '../helpers/detectionLatency';
import { estimateMotion, findFeatures, followFeatures, grayscaleFrame, transformPoint } from './opticalFlow';
import type { GrayImage, Point } from './opticalFlow';
import { isOpenCvReady, loadOpenCv } from './openCv';

interface TrackingFrame {
  id: number;
  capturedAtMs: number;
  gray: GrayImage;
  bytes: number;
}

interface Track {
  corners: Point[];
  points: Point[];
  lost: boolean;
}

export interface TrackingStatistics {
  readonly frameId: number | null;
  readonly detectionFrameId: number | null;
  readonly status: 'loading' | 'waiting' | 'tracking' | 'lost' | 'correcting';
  readonly trackedBoxes: number;
  readonly heldBoxes: number;
  readonly historyFrames: number;
  readonly historyBytes: number;
  readonly latency: DetectionLatencyStatistics | null;
  readonly correctionMs: number | null;
  readonly rejectedCorrections: number;
}

export interface TrackingCorrection {
  status: 'applied' | 'history_expired' | 'tracking_failed' | 'catchup_budget_exceeded';
  sourceFrameId: number;
  appliedFrameId: number | null;
  replayedFrames: number;
  correctionMs: number;
}

interface TrackerOptions {
  historyMs?: number;
  historyFrames?: number;
  catchupBudgetMs?: number;
}

export class MotionTracker {
  private readonly history: TrackingFrame[] = [];
  private historyBytes = 0;
  private tracks: Track[] = [];
  private version = 0;
  private detectionFrameId: number | null = null;
  private correcting = false;
  private correctionMs: number | null = null;
  private rejectedCorrections = 0;
  private readonly latencies: number[] = [];
  private lastPublishedAt = -Infinity;
  private statistics: TrackingStatistics;
  private readonly historyMs: number;
  private readonly historyFrames: number;
  private readonly catchupBudgetMs: number;
  private runtimeRequested = false;

  constructor(private readonly notify: () => void = () => undefined, options: TrackerOptions = {}) {
    this.historyMs = options.historyMs ?? 5000;
    this.historyFrames = options.historyFrames ?? 180;
    this.catchupBudgetMs = options.catchupBudgetMs ?? 200;
    if (![this.historyMs, this.historyFrames, this.catchupBudgetMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new RangeError('Tracking history and catch-up limits must be positive safe integers.');
    }
    this.statistics = this.snapshot();
  }

  advance(image: ImageData, frameId: number, capturedAtMs: number): void {
    if (!this.runtimeRequested) {
      this.runtimeRequested = true;
      void loadOpenCv().catch((error: unknown) => console.error('[Pixelveil][Tracking] OpenCV initialization failed', error));
    }
    const startedAt = performance.now();
    const previous = this.history[this.history.length - 1];
    const gray = grayscaleFrame(image);
    const current: TrackingFrame = {
      id: frameId, capturedAtMs, gray, bytes: gray.pixels.byteLength,
    };
    const previouslyHeld = this.tracks.filter((track) => track.lost).length;
    if (previous) this.tracks = this.step(this.tracks, previous, current);
    this.history.push(current);
    this.historyBytes += current.bytes;
    while (this.history.length > 1 && (this.history.length > this.historyFrames || this.historyBytes > 16 * 1024 * 1024 ||
      capturedAtMs - this.history[0].capturedAtMs > this.historyMs)) {
      this.historyBytes -= this.history.shift()!.bytes;
    }
    this.latencies.push(performance.now() - startedAt);
    if (this.latencies.length > 1000) this.latencies.shift();
    this.publish(previouslyHeld !== this.tracks.filter((track) => track.lost).length);
  }

  getBoxes(): NormalizedBox[] {
    const current = this.history[this.history.length - 1];
    if (!current) return [];
    const { width, height } = current.gray;
    return this.tracks.map((track) => ({
      left: Math.max(0, Math.min(1, Math.min(...track.corners.map((point) => point.x)) / width)),
      top: Math.max(0, Math.min(1, Math.min(...track.corners.map((point) => point.y)) / height)),
      right: Math.max(0, Math.min(1, Math.max(...track.corners.map((point) => point.x)) / width)),
      bottom: Math.max(0, Math.min(1, Math.max(...track.corners.map((point) => point.y)) / height)),
    })).filter((box) => box.left < box.right && box.top < box.bottom);
  }

  getStatistics(): TrackingStatistics {
    return this.statistics;
  }

  clear(): void {
    this.tracks = [];
    this.publish(true);
  }

  reset(): void {
    this.version++;
    this.history.length = 0;
    this.historyBytes = 0;
    this.tracks = [];
    this.detectionFrameId = null;
    this.correcting = false;
    this.correctionMs = null;
    this.rejectedCorrections = 0;
    this.latencies.length = 0;
    this.publish(true);
  }

  async correct(sourceFrameId: number, boxes: readonly NormalizedBox[], signal: AbortSignal): Promise<TrackingCorrection> {
    const version = this.version;
    let replayedFrames = 0;
    const checkCurrent = () => {
      signal.throwIfAborted();
      if (version !== this.version) throw new DOMException('Tracking was reset.', 'AbortError');
    };
    checkCurrent();
    await loadOpenCv();
    checkCurrent();
    const startedAt = performance.now();
    const finish = (status: TrackingCorrection['status']): TrackingCorrection => {
      this.correcting = false;
      this.correctionMs = performance.now() - startedAt;
      if (status !== 'applied') this.rejectedCorrections++;
      this.publish(true);
      return {
        status, sourceFrameId, appliedFrameId: status === 'applied' ? this.history[this.history.length - 1]?.id ?? null : null,
        replayedFrames, correctionMs: this.correctionMs,
      };
    };
    checkCurrent();
    if (boxes.length === 0) {
      this.tracks = [];
      this.detectionFrameId = sourceFrameId;
      return finish('applied');
    }
    let cursor = this.history.find((frame) => frame.id === sourceFrameId);
    if (!cursor) return finish('history_expired');
    let candidates = boxes.map((box) => this.seed(cursor!, box));
    this.correcting = true;
    this.publish(true);
    let chunkStartedAt = performance.now();
    try {
      while (true) {
        checkCurrent();
        if (performance.now() - startedAt > this.catchupBudgetMs) return finish('catchup_budget_exceeded');
        const latest = this.history[this.history.length - 1];
        if (cursor.id === latest?.id) {
          this.tracks = candidates;
          this.detectionFrameId = sourceFrameId;
          return finish('applied');
        }
        const next = this.history.find((frame) => frame.id === cursor!.id + 1);
        if (!next) return finish('history_expired');
        candidates = this.step(candidates, cursor, next);
        replayedFrames++;
        if (candidates.some((track) => track.lost)) return finish('tracking_failed');
        cursor = next;
        if (performance.now() - chunkStartedAt >= 6) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          chunkStartedAt = performance.now();
        }
      }
    } finally {
      if (version === this.version && this.correcting) {
        this.correcting = false;
        this.publish(true);
      }
    }
  }

  private seed(frame: TrackingFrame, box: NormalizedBox): Track {
    const { width, height } = frame.gray;
    const corners = [
      { x: box.left * width, y: box.top * height }, { x: box.right * width, y: box.top * height },
      { x: box.right * width, y: box.bottom * height }, { x: box.left * width, y: box.bottom * height },
    ];
    const points = findFeatures(frame.gray, corners);
    return { corners, points, lost: points.length < 4 };
  }

  private step(tracks: readonly Track[], previous: TrackingFrame, current: TrackingFrame): Track[] {
    return tracks.map((track) => {
      if (track.lost) return track;
      if (current.capturedAtMs - previous.capturedAtMs > 250) return { ...track, lost: true, points: [] };
      const motion = estimateMotion(followFeatures(previous.gray, current.gray, track.points));
      if (!motion) return { ...track, lost: true, points: [] };
      const corners = track.corners.map((point) => transformPoint(point, motion.transform));
      let points = motion.inliers.map((match) => match.after);
      if (points.length < 20) points = findFeatures(current.gray, corners, points);
      return { corners, points, lost: points.length < 4 };
    });
  }

  private snapshot(): TrackingStatistics {
    const heldBoxes = this.tracks.filter((track) => track.lost).length;
    return {
      frameId: this.history[this.history.length - 1]?.id ?? null, detectionFrameId: this.detectionFrameId,
      status: this.runtimeRequested && !isOpenCvReady() ? 'loading' : this.correcting ? 'correcting' : heldBoxes > 0 ? 'lost' : this.tracks.length > 0 ? 'tracking' : 'waiting',
      trackedBoxes: this.tracks.length - heldBoxes, heldBoxes, historyFrames: this.history.length, historyBytes: this.historyBytes,
      latency: summarizeDetectionLatencies(this.latencies), correctionMs: this.correctionMs, rejectedCorrections: this.rejectedCorrections,
    };
  }

  private publish(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastPublishedAt < 250) return;
    this.lastPublishedAt = now;
    this.statistics = this.snapshot();
    this.notify();
  }
}
