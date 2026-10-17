import { encodeFrameDataUrl } from '../helpers/frameImage';
import { recordDetectionDiagnostic } from '../helpers/jevDiagnostics';
import { detectionLatencyWindowSize, summarizeDetectionLatencies } from '../helpers/detectionLatency';
import { getDetectionTraceId } from './FrameDetector';
import { requestEmbedding } from './embeddingClient';
import { cosineSimilarity } from './embeddingProtocol';
import type { EmbeddingVector } from './embeddingProtocol';
import type { FrameGate, FrameGateStatistics } from './FrameGate';

type Embed = typeof requestEmbedding;

export const defaultEmbeddingThreshold = 0.65;

export class EmbeddingGate implements FrameGate {
  private object = '';
  private target: EmbeddingVector | null = null;
  private readonly latencies: number[] = [];
  private readonly listeners = new Set<() => void>();
  private statistics: FrameGateStatistics;

  constructor(private readonly threshold = defaultEmbeddingThreshold, private readonly embed: Embed = requestEmbedding) {
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      throw new RangeError('Embedding similarity threshold must be between -1 and 1.');
    }
    this.statistics = this.emptyStatistics();
  }

  getStatistics(): FrameGateStatistics {
    return this.statistics;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  reset(): void {
    this.target = null;
    this.object = '';
    this.latencies.length = 0;
    this.statistics = this.emptyStatistics();
    this.notify();
  }

  async check(frame: ImageData, object: string, signal: AbortSignal): Promise<boolean> {
    const startedAt = performance.now();
    const traceId = getDetectionTraceId(signal);
    try {
      signal.throwIfAborted();
      const description = object.trim();
      if (!description) throw new Error('Embedding target must not be empty.');
      if (description !== this.object) {
        this.target = null;
        this.object = description;
      }
      let textEmbeddingMs = 0;
      const textCached = this.target !== null;
      if (!this.target) {
        const textStartedAt = performance.now();
        const target = await this.embed({ text: description }, signal);
        signal.throwIfAborted();
        this.target = target;
        textEmbeddingMs = performance.now() - textStartedAt;
      }
      const frameStartedAt = performance.now();
      const encoded = encodeFrameDataUrl(frame, 320, 320);
      const image = await this.embed({ image: encoded.image }, signal);
      signal.throwIfAborted();
      const frameEmbeddingMs = performance.now() - frameStartedAt;
      const comparisonStartedAt = performance.now();
      if (this.target.model !== image.model || this.target.values.length !== image.values.length) {
        this.target = null;
        throw new Error('Text and image embeddings must use the same model and dimensions.');
      }
      const score = cosineSimilarity(this.target.values, image.values);
      const comparisonMs = performance.now() - comparisonStartedAt;
      const passed = score >= this.threshold;
      const latencyMs = performance.now() - startedAt;
      this.latencies.push(latencyMs);
      if (this.latencies.length > detectionLatencyWindowSize) this.latencies.shift();
      this.statistics = {
        ...this.statistics, score, textEmbeddingMs, frameEmbeddingMs, comparisonMs,
        passedFrames: this.statistics.passedFrames + Number(passed),
        skippedFrames: this.statistics.skippedFrames + Number(!passed),
        latency: summarizeDetectionLatencies(this.latencies),
      };
      const diagnostic = {
        event: 'embedding_gate', provider: 'Embedding', traceId, model: image.model,
        score, threshold: this.threshold, passed, textCached,
        textEmbeddingMs, frameEmbeddingMs, comparisonMs, latencyMs,
        imageWidth: encoded.width, imageHeight: encoded.height,
        statistics: this.statistics,
      };
      recordDetectionDiagnostic(diagnostic);
      console.info('[Pixelveil][Embedding] gate', diagnostic);
      this.notify();
      return passed;
    } catch (error) {
      if (!signal.aborted) {
        this.statistics = { ...this.statistics, score: null, errorCount: this.statistics.errorCount + 1 };
        const diagnostic = {
          event: 'embedding_error', provider: 'Embedding', traceId,
          latencyMs: performance.now() - startedAt,
          reason: error instanceof SyntaxError ? 'Invalid embedding JSON.' :
            error instanceof Error ? error.message : 'Embedding pre-check failed.',
        };
        recordDetectionDiagnostic(diagnostic);
        console.warn('[Pixelveil][Embedding] error', diagnostic);
        this.notify();
      }
      throw error;
    }
  }

  private emptyStatistics(): FrameGateStatistics {
    return {
      threshold: this.threshold, score: null, passedFrames: 0, skippedFrames: 0, errorCount: 0,
      textEmbeddingMs: null, frameEmbeddingMs: null, comparisonMs: null, latency: null,
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
