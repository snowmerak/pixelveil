export interface Processor {
  process(inputFrame: ImageData, object: string): ImageData;
  reset?(): void;
  getDetectionLatencyMs?(): number | null;
  subscribeDetectionLatency?(listener: () => void): () => void;
}
