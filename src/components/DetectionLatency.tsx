import { useCallback, useSyncExternalStore } from 'react';
import { detectionLatencyWindowSize } from '../helpers/detectionLatency';
import { downloadJevLogs, getJevDiagnosticCount, subscribeJevDiagnostics } from '../helpers/jevDiagnostics';
import type { Locale, Messages } from '../i18n';
import type { Processor } from '../processors/Processor';

interface DetectionLatencyProps {
  processor: Processor;
  locale: Locale;
  messages: Messages['latency'];
  embeddingMessages: Messages['embedding'];
  trackingMessages: Messages['tracking'];
}

export function DetectionLatency({ processor, locale, messages, embeddingMessages, trackingMessages }: DetectionLatencyProps) {
  const subscribe = useCallback((listener: () => void) => {
    return processor.subscribeDetectionLatency?.(listener) ?? (() => undefined);
  }, [processor]);
  const getSnapshot = useCallback(() => processor.getDetectionLatencyStatistics?.() ?? null, [processor]);
  const statistics = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const getGateSnapshot = useCallback(() => processor.getFrameGateStatistics?.() ?? null, [processor]);
  const gate = useSyncExternalStore(subscribe, getGateSnapshot, getGateSnapshot);
  const getTrackingSnapshot = useCallback(() => processor.getTrackingStatistics?.() ?? null, [processor]);
  const tracking = useSyncExternalStore(subscribe, getTrackingSnapshot, getTrackingSnapshot);
  const logCount = useSyncExternalStore(subscribeJevDiagnostics, getJevDiagnosticCount, getJevDiagnosticCount);
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const formatLatency = (latencyMs: number | undefined) => latencyMs === undefined ? '—' : `${numberFormat.format(latencyMs)} ms`;

  return (
    <aside className="detection-latency" aria-label={messages.label}>
      <section className="detection-latency__section" aria-label={messages.label} title={messages.hint}>
        <div className="detection-latency__header">
          <span>{messages.label}</span>
          <span className="detection-latency__value">{formatLatency(statistics?.latestMs)}</span>
        </div>
        <dl className="detection-latency__percentiles">
          <div><dt>p50</dt><dd className="detection-latency__value">{formatLatency(statistics?.p50Ms)}</dd></div>
          <div><dt>p90</dt><dd className="detection-latency__value">{formatLatency(statistics?.p90Ms)}</dd></div>
          <div><dt>p99</dt><dd className="detection-latency__value">{formatLatency(statistics?.p99Ms)}</dd></div>
        </dl>
        <span>{messages.samples}: {numberFormat.format(statistics?.sampleCount ?? 0)} / {numberFormat.format(detectionLatencyWindowSize)}</span>
        {statistics !== null && statistics.sampleCount < 100 && <span className="detection-latency__hint">{messages.smallSample}</span>}
      </section>
      {gate !== null && (
        <section className="detection-latency__section" aria-label={embeddingMessages.label} title={embeddingMessages.hintLatency}>
          <div className="detection-latency__header">
            <span>{embeddingMessages.label}</span>
            <span className="detection-latency__value">{formatLatency(gate.latency?.latestMs)}</span>
          </div>
          <span>{embeddingMessages.score}: {gate.score === null ? '—' : gate.score.toFixed(3)} / {gate.threshold.toFixed(2)}</span>
          <dl className="detection-latency__percentiles">
            <div><dt>p50</dt><dd>{formatLatency(gate.latency?.p50Ms)}</dd></div>
            <div><dt>p90</dt><dd>{formatLatency(gate.latency?.p90Ms)}</dd></div>
            <div><dt>p99</dt><dd>{formatLatency(gate.latency?.p99Ms)}</dd></div>
          </dl>
          <span>{embeddingMessages.passed}: {gate.passedFrames} · {embeddingMessages.skipped}: {gate.skippedFrames} · {embeddingMessages.errors}: {gate.errorCount}</span>
          <span className="detection-latency__hint">
            {embeddingMessages.text}: {formatLatency(gate.textEmbeddingMs ?? undefined)} · {embeddingMessages.frame}: {formatLatency(gate.frameEmbeddingMs ?? undefined)} · {embeddingMessages.comparison}: {gate.comparisonMs === null ? '—' : `${gate.comparisonMs.toFixed(2)} ms`}
          </span>
          <span>{messages.samples}: {gate.latency?.sampleCount ?? 0} / {detectionLatencyWindowSize}</span>
          {gate.latency !== null && gate.latency.sampleCount < 100 && <span className="detection-latency__hint">{messages.smallSample}</span>}
        </section>
      )}
      {tracking !== null && (
        <section className="detection-latency__section" aria-label={trackingMessages.label}>
          <div className="detection-latency__header">
            <span>{trackingMessages.label}</span>
            <span className="detection-latency__value">{formatLatency(tracking.latency?.latestMs)}</span>
          </div>
          <span>{trackingMessages.status[tracking.status]}</span>
          <span>{trackingMessages.tracked}: {tracking.trackedBoxes} · {trackingMessages.held}: {tracking.heldBoxes}</span>
          <details className="tracking-details">
            <summary>{trackingMessages.details}</summary>
            <dl className="detection-latency__percentiles">
              <div><dt>p50</dt><dd>{formatLatency(tracking.latency?.p50Ms)}</dd></div>
              <div><dt>p90</dt><dd>{formatLatency(tracking.latency?.p90Ms)}</dd></div>
              <div><dt>p99</dt><dd>{formatLatency(tracking.latency?.p99Ms)}</dd></div>
            </dl>
            <p>{trackingMessages.frame}: {tracking.frameId ?? '—'} · {trackingMessages.source}: {tracking.detectionFrameId ?? '—'}</p>
            <p>{trackingMessages.correction}: {formatLatency(tracking.correctionMs ?? undefined)}</p>
            <p>{trackingMessages.rejected}: {tracking.rejectedCorrections} · {trackingMessages.history}: {tracking.historyFrames}</p>
            {tracking.latency !== null && tracking.latency.sampleCount < 100 && <p>{messages.smallSample}</p>}
          </details>
        </section>
      )}
      <div className="detection-latency__actions">
        <button
          type="button"
          className="mp-button mp-button--secondary"
          onClick={downloadJevLogs}
          disabled={logCount === 0}
          title={messages.exportHint}
        >
          {messages.exportLogs} ({numberFormat.format(logCount)})
        </button>
      </div>
    </aside>
  );
}
