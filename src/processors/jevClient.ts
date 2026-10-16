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
  return [parseBoxAnswer(target)];
}

function parseBoxAnswer(answer: unknown): NormalizedBox {
  if (!isRecord(answer) || answer.type !== 'box' || !isRecord(answer.box)) {
    throw new Error('Invalid Jev box answer.');
  }
  const { left, top, right, bottom } = answer.box;
  if (!isProbability(left) || !isProbability(top) || !isProbability(right) || !isProbability(bottom) ||
      left >= right || top >= bottom) {
    throw new Error('Invalid Jev box coordinates.');
  }
  return { left, top, right, bottom };
}

export function parseJevCount(value: unknown): number {
  if (!isRecord(value) || !isRecord(value.answers) || !isRecord(value.answers.count)) {
    throw new Error('Invalid Jev count answer.');
  }
  const answer = value.answers.count;
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !/^count_[0-6]$/.test(answer.choice)) {
    throw new Error('Invalid Jev count choice.');
  }
  return Number(answer.choice.slice('count_'.length));
}

export function parseJevScrollBoxes(value: unknown, count: number): NormalizedBox[] {
  if (!Number.isInteger(count) || count < 1 || count > 6) throw new RangeError('Box count must be between 1 and 6.');
  if (!isRecord(value) || !isRecord(value.answers)) throw new Error('Invalid Jev response.');
  const answers = value.answers;
  return Array.from({ length: count }, (_, index) => parseBoxAnswer(answers[`target_${index + 1}`]));
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

type JevQuestion = {
  type: 'noul' | 'box' | 'choice';
  instructions: string;
  criteria?: Record<string, string>;
};

async function requestJev(image: Blob, questions: Record<string, JevQuestion>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const reference = crypto.randomUUID();
  const body = new FormData();
  body.append('request', new Blob([JSON.stringify({
    model: 'jev-preview',
    state: { photo: reference },
    assets: { [reference]: { type: 'image', part: 'frame' } },
    questions,
  })], { type: 'application/json' }));
  body.append('frame', image, 'frame.png');

  const response = await fetch('/api/jev', { method: 'POST', body, signal });
  if (!response.ok) {
    if (response.status === 503) throw new Error('Set TYPESAFE_API_KEY in .env.local and restart Vite.');
    if (response.status === 504) throw new Error('The Jev request timed out. Start the camera to retry.');
    throw new Error(`Jev request failed (HTTP ${response.status}). Start the camera to retry.`);
  }
  const result: unknown = await response.json();
  signal.throwIfAborted();
  return result;
}

export const detectJevBoxes: FrameDetector = async (frame, object, signal) => {
  signal.throwIfAborted();
  const image = await encodeFrame(frame);
  return parseJevBoxes(await requestJev(image, {
    present: { type: 'noul', instructions: `Is the following object visible in \`photo\`? ${object}` },
    target: { type: 'box', instructions: `Find one object matching this description in \`photo\`: ${object}` },
  }, signal));
};

export const detectJevScrollBoxes: FrameDetector = async (frame, object, signal) => {
  signal.throwIfAborted();
  const image = await encodeFrame(frame);
  const criteria = Object.fromEntries(Array.from({ length: 7 }, (_, count) => [
    `count_${count}`,
    count === 6 ? 'Six or more matching objects are visible.' : `Exactly ${count} matching objects are visible.`,
  ]));
  const count = parseJevCount(await requestJev(image, {
    count: {
      type: 'choice',
      instructions: `How many distinct objects matching this description are visible in \`photo\`? ${object}`,
      criteria,
    },
  }, signal));
  if (count === 0) return [];

  const questions: Record<string, JevQuestion> = {};
  for (let position = 1; position <= count; position++) {
    questions[`target_${position}`] = {
      type: 'box',
      instructions: `Find matching object number ${position} of ${count} in \`photo\` (1-based). ` +
        'Order matching objects from top to bottom by their top edge, breaking ties from left to right by their left edge. ' +
        'Return the box for only this position, not the group. ' +
        `Object description: ${object}`,
    };
  }
  return parseJevScrollBoxes(await requestJev(image, questions, signal), count);
};
