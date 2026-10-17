export interface NormalizedBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type FrameDetector = (
  frame: ImageData,
  object: string,
  signal: AbortSignal,
  previousCount?: number,
) => Promise<NormalizedBox[]>;

const detectionTraces = new WeakMap<AbortSignal, string>();

export function getDetectionTraceId(signal: AbortSignal): string {
  let traceId = detectionTraces.get(signal);
  if (!traceId) {
    traceId = crypto.randomUUID();
    detectionTraces.set(signal, traceId);
  }
  return traceId;
}
