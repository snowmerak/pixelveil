import type { DetectionLatencyStatistics } from '../helpers/detectionLatency';
import type { FrameGate, FrameGateStatistics } from './FrameGate';
import type { TrackingStatistics } from '../tracking/MotionTracker';

export interface Processor {
  process(inputFrame: ImageData, object: string): ImageData;
  reset?(): void;
  setFrameGate?(gate: FrameGate | null): void;
  getFrameGateStatistics?(): FrameGateStatistics | null;
  setTrackingEnabled?(enabled: boolean): void;
  getTrackingStatistics?(): TrackingStatistics | null;
  getDetectionLatencyMs?(): number | null;
  getDetectionLatencyStatistics?(): DetectionLatencyStatistics | null;
  subscribeDetectionLatency?(listener: () => void): () => void;
}
