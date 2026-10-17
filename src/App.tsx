import { useMemo, useState } from 'react';
import { FrameCanvas } from './components/FrameCanvas';
import { DetectionLatency } from './components/DetectionLatency';
import { useWebcamProcessor } from './hooks/useWebcamProcessor';
import { useLocale } from './i18n';
import { processorDefinitions } from './processors/registry';
import { isVlmModel, vlmModels } from './processors/vlmProtocol';
import type { VlmModel } from './processors/vlmProtocol';

export function App() {
  const { locale, setLocale, messages } = useLocale();
  const [processorId, setProcessorId] = useState(processorDefinitions[0].id);
  const [object, setObject] = useState('');
  const [vlmModel, setVlmModel] = useState<VlmModel>(vlmModels[0]);
  const definition = processorDefinitions.find((entry) => entry.id === processorId) ?? processorDefinitions[0];
  const selectedModel = definition.requiresVlmModel ? vlmModel : undefined;
  const processor = useMemo(() => definition.create(selectedModel), [definition, selectedModel]);
  const camera = useWebcamProcessor(processor, object);
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
            disabled={!active && definition.requiresObject && !object.trim()}
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
        {definition.requiresVlmModel && (
          <div className="mp-field model-field">
            <label className="mp-field__label" htmlFor="vlm-model">{messages.vlmModel}</label>
            <select
              id="vlm-model"
              className="mp-select"
              value={vlmModel}
              onChange={(event) => { if (isVlmModel(event.target.value)) setVlmModel(event.target.value); }}
            >
              {vlmModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>
        )}
        <div className="processor-details">
          <p id="processor-description">{definition.description[locale]}</p>
          <p className="mp-text--muted">{definition.requiresObject ? messages.jevHint : messages.noSettings}</p>
        </div>
        {definition.requiresObject && (
          <div className="mp-field object-field">
            <label className="mp-field__label" htmlFor="object">{messages.object}</label>
            <input
              id="object"
              className="mp-input"
              type="text"
              value={object}
              maxLength={2000}
              onChange={(event) => setObject(event.target.value)}
              placeholder={messages.objectPlaceholder}
            />
          </div>
        )}
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

      <p className="workspace-note">{definition.requiresVlmModel ? messages.vlmProcessing :
        definition.requiresObject ? messages.remoteProcessing : messages.localProcessing}</p>
      <DetectionLatency processor={processor} locale={locale} messages={messages.latency} />
      <video ref={camera.videoRef} muted playsInline hidden />
    </main>
  );
}
