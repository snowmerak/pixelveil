import { useCallback, useSyncExternalStore } from 'react';
import { detectionLatencyWindowSize } from '../helpers/detectionLatency';
import { downloadJevLogs, getJevDiagnosticCount, subscribeJevDiagnostics } from '../helpers/jevDiagnostics';
import type { Locale, Messages } from '../i18n';
import type { Processor } from '../processors/Processor';

interface DetectionLatencyProps {
  processor: Processor;
  locale: Locale;
  messages: Messages['latency'];
}

export function DetectionLatency({ processor, locale, messages }: DetectionLatencyProps) {
  const subscribe = useCallback((listener: () => void) => {
    return processor.subscribeDetectionLatency?.(listener) ?? (() => undefined);
  }, [processor]);
  const getSnapshot = useCallback(() => processor.getDetectionLatencyStatistics?.() ?? null, [processor]);
  const statistics = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const logCount = useSyncExternalStore(subscribeJevDiagnostics, getJevDiagnosticCount, getJevDiagnosticCount);
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const formatLatency = (latencyMs: number | undefined) => latencyMs === undefined ? '—' : `${numberFormat.format(latencyMs)} ms`;

  return (
    <aside className="detection-latency" aria-label={messages.label} title={messages.hint}>
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
      <button
        type="button"
        className="mp-button mp-button--secondary"
        onClick={downloadJevLogs}
        disabled={logCount === 0}
        title={messages.exportHint}
      >
        {messages.exportLogs} ({numberFormat.format(logCount)})
      </button>
    </aside>
  );
}
