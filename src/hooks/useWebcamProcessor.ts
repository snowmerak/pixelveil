import { useCallback, useEffect, useRef, useState } from 'react';
import type { Processor } from '../processors/Processor';

type CameraStatus = 'idle' | 'requesting' | 'running' | 'error';

interface CameraError {
  code: 'permissionDenied' | 'notFound' | 'notReadable' | 'startFailed' |
    'unsupported' | 'disconnected' | 'canvasUnavailable' | 'processingFailed';
  detail?: string;
}

function getCameraError(error: unknown): CameraError {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return { code: 'permissionDenied' };
      case 'NotFoundError':
        return { code: 'notFound' };
      case 'NotReadableError':
        return { code: 'notReadable' };
    }
  }

  return { code: 'startFailed' };
}

export function useWebcamProcessor(processor: Processor, object: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);

  const fail = useCallback((error: CameraError) => {
    setEnabled(false);
    setStatus('error');
    setError(error);
  }, []);

  const start = () => {
    setError(null);
    setStatus('requesting');
    setEnabled(true);
  };

  const stop = () => {
    setEnabled(false);
    setStatus('idle');
    setError(null);
  };

  useEffect(() => {
    if (!enabled) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const openCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail({ code: 'unsupported' });
        return;
      }

      try {
        const acquiredStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (cancelled) {
          acquiredStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = acquiredStream;
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (!cancelled) fail({ code: 'disconnected' });
          });
        });
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setStatus('running');
      } catch (cameraError) {
        if (!cancelled) fail(getCameraError(cameraError));
      }
    };

    void openCamera();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
    };
  }, [enabled, fail]);

  useEffect(() => {
    if (status !== 'running') return;

    const video = videoRef.current;
    const inputCanvas = inputCanvasRef.current;
    const outputCanvas = outputCanvasRef.current;
    if (!video || !inputCanvas || !outputCanvas) return;

    const inputContext = inputCanvas.getContext('2d', { willReadFrequently: true });
    const outputContext = outputCanvas.getContext('2d');
    if (!inputContext || !outputContext) {
      fail({ code: 'canvasUnavailable' });
      return;
    }

    let animationId = 0;
    let previousTime = -1;

    const renderFrame = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 && video.videoHeight > 0 &&
          video.currentTime !== previousTime) {
        try {
          previousTime = video.currentTime;
          if (inputCanvas.width !== video.videoWidth || inputCanvas.height !== video.videoHeight) {
            inputCanvas.width = video.videoWidth;
            inputCanvas.height = video.videoHeight;
          }

          inputContext.drawImage(video, 0, 0);
          const inputFrame = inputContext.getImageData(0, 0, inputCanvas.width, inputCanvas.height);
          const outputFrame = processor.process(inputFrame, object);

          if (outputCanvas.width !== outputFrame.width || outputCanvas.height !== outputFrame.height) {
            outputCanvas.width = outputFrame.width;
            outputCanvas.height = outputFrame.height;
          }
          outputContext.putImageData(outputFrame, 0, 0);
        } catch (processingError) {
          const detail = processingError instanceof Error ? processingError.message : undefined;
          fail({ code: 'processingFailed', detail });
          return;
        }
      }

      animationId = requestAnimationFrame(renderFrame);
    };

    animationId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(animationId);
      processor.reset?.();
    };
  }, [status, processor, object, fail]);

  return { videoRef, inputCanvasRef, outputCanvasRef, status, error, start, stop };
}
