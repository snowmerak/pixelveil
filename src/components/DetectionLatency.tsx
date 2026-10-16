import { useCallback, useSyncExternalStore } from 'react';
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
  const getSnapshot = useCallback(() => processor.getDetectionLatencyMs?.() ?? null, [processor]);
  const latencyMs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <aside className="detection-latency" aria-label={messages.label} title={messages.hint}>
      <span>{messages.label}</span>
      <span className="detection-latency__value">
        {latencyMs === null ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(latencyMs)} ms`}
      </span>
    </aside>
  );
}
