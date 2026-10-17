const eventLimit = 3000;
const startedAt = new Date().toISOString();
const events: Record<string, unknown>[] = [];
const listeners = new Set<() => void>();
let recordedEventCount = 0;

export function recordDetectionDiagnostic(event: Record<string, unknown> & { event: string }): void {
  recordedEventCount++;
  events.push({
    ...structuredClone(event),
    sequence: recordedEventCount,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  if (events.length > eventLimit) events.shift();
  listeners.forEach((listener) => listener());
}

export const recordJevDiagnostic = recordDetectionDiagnostic;

export function subscribeJevDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getJevDiagnosticCount(): number {
  return events.length;
}

export function getJevLogExport() {
  return {
    schemaVersion: 1,
    startedAt,
    exportedAt: new Date().toISOString(),
    eventLimit,
    recordedEventCount,
    droppedEventCount: recordedEventCount - events.length,
    events: structuredClone(events),
  };
}

export function downloadJevLogs(): void {
  const report = getJevLogExport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const source = report.events.some((event) => event.provider === 'VLM') ? 'detection' : 'jev';
  link.download = `pixelveil-${source}-${report.exportedAt.replace(/[:.]/g, '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
