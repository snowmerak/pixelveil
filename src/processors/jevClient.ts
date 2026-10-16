export interface NormalizedBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type FrameDetector = (frame: ImageData, object: string, signal: AbortSignal) => Promise<NormalizedBox[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseJevBoxes(value: unknown): NormalizedBox[] {
  if (!isRecord(value) || !isRecord(value.answers)) throw new Error('Invalid Jev response.');
  const { present, target } = value.answers;
  if (!isRecord(present) || present.type !== 'noul' || !isProbability(present.noul)) {
    throw new Error('Invalid Jev presence answer.');
  }
  if (present.noul < 0.5) return [];
  if (!isRecord(target) || target.type !== 'box' || !isRecord(target.box)) {
    throw new Error('Invalid Jev box answer.');
  }
  const { left, top, right, bottom } = target.box;
  if (!isProbability(left) || !isProbability(top) || !isProbability(right) || !isProbability(bottom) ||
      left >= right || top >= bottom) {
    throw new Error('Invalid Jev box coordinates.');
  }
  return [{ left, top, right, bottom }];
}

export function encodeFrame(frame: ImageData): Promise<Blob> {
  const source = document.createElement('canvas');
  source.width = frame.width;
  source.height = frame.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Canvas 2D rendering is unavailable.');
  sourceContext.putImageData(frame, 0, 0);

  const scale = Math.min(1, 1568 / Math.max(frame.width, frame.height));
  const image = document.createElement('canvas');
  image.width = Math.max(280, Math.round(frame.width * scale));
  image.height = Math.max(280, Math.round(frame.height * scale));
  const imageContext = image.getContext('2d');
  if (!imageContext) throw new Error('Canvas 2D rendering is unavailable.');
  imageContext.drawImage(source, 0, 0, image.width, image.height);

  return new Promise((resolve, reject) => {
    image.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to encode the camera frame.'));
    }, 'image/png');
  });
}

export const detectJevBoxes: FrameDetector = async (frame, object, signal) => {
  signal.throwIfAborted();
  const image = await encodeFrame(frame);
  signal.throwIfAborted();
  const reference = crypto.randomUUID();
  const body = new FormData();
  body.append('request', new Blob([JSON.stringify({
    model: 'jev-preview',
    state: { photo: reference },
    assets: { [reference]: { type: 'image', part: 'frame' } },
    questions: {
      present: { type: 'noul', instructions: `Is the following object visible in \`photo\`? ${object}` },
      target: { type: 'box', instructions: `Find one object matching this description in \`photo\`: ${object}` },
    },
  })], { type: 'application/json' }));
  body.append('frame', image, 'frame.png');

  const response = await fetch('/api/jev', { method: 'POST', body, signal });
  if (!response.ok) {
    if (response.status === 503) throw new Error('Set TYPESAFE_API_KEY in .env.local and restart Vite.');
    if (response.status === 504) throw new Error('The Jev request timed out. Start the camera to retry.');
    throw new Error(`Jev request failed (HTTP ${response.status}). Start the camera to retry.`);
  }
  return parseJevBoxes(await response.json());
};
