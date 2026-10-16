export const detectionLatencyWindowSize = 1000;

export interface DetectionLatencyStatistics {
  readonly sampleCount: number;
  readonly latestMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
}

export function summarizeDetectionLatencies(samples: readonly number[]): DetectionLatencyStatistics | null {
  if (samples.length === 0) return null;
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new RangeError('Detection latencies must be finite, non-negative numbers.');
  }
  const sorted = [...samples].sort((first, second) => first - second);
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1];
  return {
    sampleCount: samples.length,
    latestMs: samples[samples.length - 1],
    p50Ms: percentile(0.5),
    p90Ms: percentile(0.9),
    p99Ms: percentile(0.99),
  };
}
