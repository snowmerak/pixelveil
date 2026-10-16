import type { DetectionLatencyStatistics } from '../helpers/detectionLatency';

export interface Processor {
  process(inputFrame: ImageData, object: string): ImageData;
  reset?(): void;
  getDetectionLatencyMs?(): number | null;
  getDetectionLatencyStatistics?(): DetectionLatencyStatistics | null;
  subscribeDetectionLatency?(listener: () => void): () => void;
}
