export interface NormalizedBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type FrameDetector = (
  frame: ImageData,
  object: string,
  signal: AbortSignal,
  previousCount?: number,
) => Promise<NormalizedBox[]>;

const detectionTraces = new WeakMap<AbortSignal, string>();
const panningBoxCount = 6;

export function getJevTraceId(signal: AbortSignal): string {
  let traceId = detectionTraces.get(signal);
  if (!traceId) {
    traceId = crypto.randomUUID();
    detectionTraces.set(signal, traceId);
  }
  return traceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseJevBoxes(value: unknown): NormalizedBox[] {
  if (!isRecord(value) || !isRecord(value.answers)) throw new Error('Invalid Jev response.');
  const { present, target } = value.answers;
  if (!parsePresenceAnswer(present)) return [];
  return [parseBoxAnswer(target)];
}

function parsePresenceAnswer(answer: unknown): boolean {
  if (!isRecord(answer) || answer.type !== 'noul' || !isProbability(answer.noul)) {
    throw new Error('Invalid Jev presence answer.');
  }
  return answer.noul >= 0.5;
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

function parsePanningBoxAnswer(answer: unknown): NormalizedBox | null {
  if (isRecord(answer) && answer.type === 'box' && isRecord(answer.box)) {
    const { left, top, right, bottom } = answer.box;
    if (left === 0 && top === 0 && right === 0 && bottom === 0) return null;
  }
  return parseBoxAnswer(answer);
}

export function parseJevPanningBoxes(value: unknown): NormalizedBox[] {
  if (!isRecord(value) || !isRecord(value.answers)) throw new Error('Invalid Jev response.');
  const boxes: NormalizedBox[] = [];
  for (let position = 1; position <= panningBoxCount; position++) {
    const box = parsePanningBoxAnswer(value.answers[`target_${position}`]);
    if (box !== null) boxes.push(box);
  }
  return boxes;
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
  const boxes: NormalizedBox[] = [];
  for (let position = 1; position <= count; position++) {
    if (parsePresenceAnswer(answers[`present_${position}`])) {
      boxes.push(parseBoxAnswer(answers[`target_${position}`]));
    }
  }
  return boxes;
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

function logNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function logJevResponse(requestId: string, questions: Record<string, JevQuestion>, result: unknown, signal: AbortSignal, requestLatencyMs: number) {
  const answers = isRecord(result) && isRecord(result.answers) ? result.answers : {};
  const rows = Object.entries(questions).filter(([, question]) => question.type === 'box').map(([question]) => {
    const answer = answers[question];
    const box = isRecord(answer) && isRecord(answer.box) ? answer.box : {};
    const presenceQuestion = question.replace(/^target/, 'present');
    const presence = answers[presenceQuestion];
    let disposition: string;
    try {
      if (!Object.hasOwn(questions, presenceQuestion)) {
        disposition = parsePanningBoxAnswer(answer) === null ? 'zero_box' : 'accepted';
      } else if (!parsePresenceAnswer(presence)) disposition = 'absent';
      else {
        parseBoxAnswer(answer);
        disposition = 'accepted';
      }
    } catch {
      disposition = 'invalid';
    }
    return {
      question,
      left: logNumber(box.left),
      top: logNumber(box.top),
      right: logNumber(box.right),
      bottom: logNumber(box.bottom),
      confidence: isRecord(answer) ? logNumber(answer.confidence) : null,
      presence: isRecord(presence) ? logNumber(presence.noul) : null,
      disposition: signal.aborted ? 'ignored_cancelled' : disposition,
    };
  });
  const countAnswer = answers.count;
  const countChoice = isRecord(countAnswer) && countAnswer.type === 'choice' &&
    typeof countAnswer.choice === 'string' && /^count_[0-6]$/.test(countAnswer.choice) ? countAnswer.choice : null;

  console.groupCollapsed(`[Pixelveil][Jev] response ${requestId}`);
  console.info('[Pixelveil][Jev] response', {
    event: 'jev_response',
    timestamp: new Date().toISOString(),
    traceId: getJevTraceId(signal),
    requestId,
    requestLatencyMs: Math.round(requestLatencyMs),
    cancelled: signal.aborted,
    countChoice,
    requestedBoxes: rows.length,
    acceptedBoxes: rows.filter((row) => row.disposition === 'accepted').length,
    boxes: rows,
  });
  if (rows.length > 0) console.table(rows);
  console.groupEnd();
}

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

  const startedAt = performance.now();
  const response = await fetch('/api/jev', { method: 'POST', body, signal });
  if (!response.ok) {
    console.warn('[Pixelveil][Jev] response_error', {
      traceId: getJevTraceId(signal),
      requestId: reference,
      status: response.status,
      requestLatencyMs: Math.round(performance.now() - startedAt),
    });
    if (response.status === 503) throw new Error('Set TYPESAFE_API_KEY in .env.local and restart Vite.');
    if (response.status === 504) throw new Error('The Jev request timed out. Start the camera to retry.');
    throw new Error(`Jev request failed (HTTP ${response.status}). Start the camera to retry.`);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (!signal.aborted) {
      console.warn('[Pixelveil][Jev] invalid_response', {
        traceId: getJevTraceId(signal),
        requestId: reference,
        status: response.status,
      });
    }
    throw error;
  }
  logJevResponse(reference, questions, result, signal, performance.now() - startedAt);
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

export const detectJevScrollBoxes: FrameDetector = async (frame, object, signal, previousCount) => {
  signal.throwIfAborted();
  if (previousCount !== undefined && (!Number.isInteger(previousCount) || previousCount < 0 || previousCount > 6)) {
    throw new RangeError('Previous box count must be between 0 and 6.');
  }
  const image = await encodeFrame(frame);
  let count: number;
  if (previousCount === undefined) {
    const criteria = Object.fromEntries(Array.from({ length: 7 }, (_, option) => [
      `count_${option}`,
      option === 6 ? 'Six or more matching objects are visible.' : `Exactly ${option} matching objects are visible.`,
    ]));
    count = parseJevCount(await requestJev(image, {
      count: {
        type: 'choice',
        instructions: `How many distinct objects matching this description are visible in \`photo\`? ${object}`,
        criteria,
      },
    }, signal));
  } else {
    count = Math.min(previousCount + 1, 6);
  }
  if (count === 0) return [];

  const questions: Record<string, JevQuestion> = {};
  const ordering = 'Order matching objects from top to bottom by their top edge, breaking ties from left to right by their left edge. ';
  for (let position = 1; position <= count; position++) {
    questions[`present_${position}`] = {
      type: 'noul',
      instructions: `Does a distinct matching object at position ${position} (1-based) exist in \`photo\`? ` +
        ordering + `Object description: ${object}`,
    };
    questions[`target_${position}`] = {
      type: 'box',
      instructions: `Find the matching object at position ${position} (1-based) in \`photo\`. ` +
        ordering +
        'Return the box for only this position, not the group. ' +
        `Object description: ${object}`,
    };
  }
  return parseJevScrollBoxes(await requestJev(image, questions, signal), count);
};

export const detectJevPanningBoxes: FrameDetector = async (frame, object, signal) => {
  signal.throwIfAborted();
  const image = await encodeFrame(frame);
  const questions: Record<string, JevQuestion> = {};
  for (let position = 1; position <= panningBoxCount; position++) {
    questions[`target_${position}`] = {
      type: 'box',
      instructions: `Find the distinct matching object at position ${position} (1-based) in \`photo\`. ` +
        'Order matching objects from top to bottom by their top edge, breaking ties from left to right by their left edge. ' +
        'Return the tight bounding box for only this one object, not a group or another position. ' +
        'The number of matching objects is unknown; do not assume there are six. ' +
        'If no matching object exists at this position, return exactly left=0, top=0, right=0, bottom=0. ' +
        `Object description: ${object}`,
    };
  }
  return parseJevPanningBoxes(await requestJev(image, questions, signal));
};
