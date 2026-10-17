import { recordDetectionDiagnostic } from '../helpers/jevDiagnostics';
import { getDetectionTraceId } from './FrameDetector';
import type { FrameDetector } from './FrameDetector';
import { parseVlmCompletion, VlmResponseError } from './vlmProtocol';
import type { VlmModel } from './vlmProtocol';

export function encodeVlmFrame(frame: ImageData): { image: string; width: number; height: number } {
  const source = document.createElement('canvas');
  source.width = frame.width;
  source.height = frame.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Canvas 2D rendering is unavailable.');
  sourceContext.putImageData(frame, 0, 0);

  const scale = Math.min(1, 1280 / frame.width, 720 / frame.height);
  const image = document.createElement('canvas');
  image.width = Math.max(1, Math.round(frame.width * scale));
  image.height = Math.max(1, Math.round(frame.height * scale));
  const context = image.getContext('2d');
  if (!context) throw new Error('Canvas 2D rendering is unavailable.');
  context.drawImage(source, 0, 0, image.width, image.height);
  return { image: image.toDataURL('image/png'), width: image.width, height: image.height };
}

export function createVlmDetector(model: VlmModel): FrameDetector {
  return async (frame, object, signal) => {
    signal.throwIfAborted();
    const encoded = encodeVlmFrame(frame);
    const traceId = getDetectionTraceId(signal);
    const startedAt = performance.now();
    let status: number | null = null;
    try {
      const response = await fetch('/api/vlm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, object, image: encoded.image }),
        signal,
      });
      status = response.status;
      if (!response.ok) {
        if (status === 504) throw new Error('The VLM request timed out. Start the camera to retry.');
        throw new Error(`VLM request failed (HTTP ${status}). Check the model server and VLM settings, then restart the camera.`);
      }
      let completion: unknown;
      try {
        completion = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw new VlmResponseError('VLM response was not valid JSON.');
        throw error;
      }
      signal.throwIfAborted();
      const boxes = parseVlmCompletion(completion, (rejection) => {
        const diagnostic = { event: 'vlm_box_rejected', provider: 'VLM', model, traceId, ...rejection };
        recordDetectionDiagnostic(diagnostic);
        console.warn('[Pixelveil][VLM] box_rejected', diagnostic);
      });
      signal.throwIfAborted();
      const diagnostic = {
        event: 'vlm_response', provider: 'VLM', model, traceId,
        requestLatencyMs: Math.round(performance.now() - startedAt),
        imageWidth: encoded.width, imageHeight: encoded.height,
        boxCount: boxes.length, boxes,
      };
      recordDetectionDiagnostic(diagnostic);
      console.info('[Pixelveil][VLM] response', diagnostic);
      return boxes;
    } catch (error) {
      if (!signal.aborted) {
        const diagnostic = {
          event: 'vlm_error', provider: 'VLM', model, traceId, status,
          requestLatencyMs: Math.round(performance.now() - startedAt),
          recoverable: error instanceof VlmResponseError,
          reason: error instanceof VlmResponseError ? error.message : 'VLM request failed.',
        };
        recordDetectionDiagnostic(diagnostic);
        console.warn('[Pixelveil][VLM] error', diagnostic);
      }
      throw error;
    }
  };
}
