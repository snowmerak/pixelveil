import type { DetectionLatencyStatistics } from '../helpers/detectionLatency';

export interface FrameGateStatistics {
  readonly threshold: number;
  readonly score: number | null;
  readonly passedFrames: number;
  readonly skippedFrames: number;
  readonly errorCount: number;
  readonly textEmbeddingMs: number | null;
  readonly frameEmbeddingMs: number | null;
  readonly comparisonMs: number | null;
  readonly latency: DetectionLatencyStatistics | null;
}

export interface FrameGate {
  check(frame: ImageData, object: string, signal: AbortSignal): Promise<boolean>;
  reset(): void;
  getStatistics(): FrameGateStatistics;
  subscribe(listener: () => void): () => void;
}
