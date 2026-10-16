import type { Ref } from 'react';
import type { Messages } from '../i18n';

interface FrameCanvasProps {
  canvasRef: Ref<HTMLCanvasElement>;
  title: string;
  description: string;
  running: boolean;
  messages: Messages['canvas'];
}

export function FrameCanvas({ canvasRef, title, description, running, messages }: FrameCanvasProps) {
  return (
    <section className="mp-card frame-panel" aria-label={title}>
      <header className="frame-heading">
        <h2>{title}</h2>
        <span className="frame-description">{description}</span>
      </header>
      <div className="frame-viewport">
        <canvas ref={canvasRef} width={1280} height={720} aria-label={`${title} ${messages.frameLabel}`}>
          {messages.unsupported}
        </canvas>
        {!running && <p className="frame-placeholder">{messages.waiting}</p>}
      </div>
    </section>
  );
}
