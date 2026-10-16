import { useMemo, useState } from 'react';
import { FrameCanvas } from './components/FrameCanvas';
import { useWebcamProcessor } from './hooks/useWebcamProcessor';
import { useLocale } from './i18n';
import { processorDefinitions } from './processors/registry';

export function App() {
  const { locale, setLocale, messages } = useLocale();
  const [processorId, setProcessorId] = useState(processorDefinitions[0].id);
  const definition = processorDefinitions.find((entry) => entry.id === processorId) ?? processorDefinitions[0];
  const processor = useMemo(() => definition.create(), [definition]);
  const camera = useWebcamProcessor(processor, '');
  const running = camera.status === 'running';
  const active = running || camera.status === 'requesting';

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <h1>Pixelveil</h1>
          <p className="mp-text--secondary">{messages.workspaceSubtitle}</p>
        </div>
        <div className="mp-button-row">
          <select
            className="mp-select language-select"
            id="language"
            aria-label={messages.language}
            value={locale}
            onChange={(event) => setLocale(event.target.value === 'ko' ? 'ko' : 'en')}
          >
            <option value="en" lang="en">English</option>
            <option value="ko" lang="ko">한국어</option>
          </select>
          <button
            type="button"
            className={`mp-button mp-button--${active ? 'secondary' : 'primary'}`}
            onClick={active ? camera.stop : camera.start}
          >
            {active ? messages.stopCamera : messages.startCamera}
          </button>
        </div>
      </header>

      <section className="mp-card processor-panel" aria-labelledby="processor-heading">
        <div className="mp-field">
          <label className="mp-field__label" id="processor-heading" htmlFor="processor">{messages.processor}</label>
          <select
            className="mp-select"
            id="processor"
            value={processorId}
            onChange={(event) => setProcessorId(event.target.value)}
            aria-describedby="processor-description"
          >
            {processorDefinitions.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </div>
        <div className="processor-details">
          <p id="processor-description">{definition.description[locale]}</p>
          <p className="mp-text--muted">{messages.noSettings}</p>
        </div>
      </section>

      {camera.error && (
        <p className="camera-error" role="alert">
          {messages.errors[camera.error.code]}
          {camera.error.detail && ` ${camera.error.detail}`}
        </p>
      )}

      <div className="frame-grid">
        <FrameCanvas canvasRef={camera.inputCanvasRef} title={messages.original} description={messages.webcamInput} running={running} messages={messages.canvas} />
        <FrameCanvas canvasRef={camera.outputCanvasRef} title={messages.processed} description={definition.label} running={running} messages={messages.canvas} />
      </div>

      <p className="workspace-note">{messages.localProcessing}</p>
      <video ref={camera.videoRef} muted playsInline hidden />
    </main>
  );
}
