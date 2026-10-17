import type { NormalizedBox } from './FrameDetector.ts';

export const vlmModels = [
  'qwen3-vl-reap-24b-a3b',
  'qwen3.6-35b-a3b-ud-mlx',
  'gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp',
  'minicpm-v-4.7-1b@f16',
] as const;

export type VlmModel = typeof vlmModels[number];

export function isVlmModel(value: unknown): value is VlmModel {
  return vlmModels.some((model) => model === value);
}

const boxKeys = ['left', 'top', 'right', 'bottom'] as const;

export const vlmBoxSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['boxes'],
  properties: {
    boxes: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: boxKeys,
        properties: Object.fromEntries(boxKeys.map((key) => [key, { type: 'integer', minimum: 0, maximum: 1000 }])),
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class VlmResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VlmResponseError';
  }
}

export interface VlmBoxRejection {
  index: number;
  reason: 'invalid_coordinates' | 'non_positive_size';
  box: Record<typeof boxKeys[number], number | null>;
}

export function parseVlmBoxes(value: unknown, onRejectedBox?: (rejection: VlmBoxRejection) => void): NormalizedBox[] {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.boxes) || value.boxes.length > 20) {
    throw new VlmResponseError('Invalid VLM response: expected only a boxes array with at most 20 items.');
  }
  const boxes: NormalizedBox[] = [];
  value.boxes.forEach((candidate, index) => {
    const validCoordinates = isRecord(candidate) && Object.keys(candidate).length === 4 && boxKeys.every((key) =>
      typeof candidate[key] === 'number' && Number.isInteger(candidate[key]) && candidate[key] >= 0 && candidate[key] <= 1000);
    const box = candidate as unknown as NormalizedBox;
    if (!validCoordinates || box.left >= box.right || box.top >= box.bottom) {
      const coordinate = (key: typeof boxKeys[number]): number | null =>
        isRecord(candidate) && typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) ? candidate[key] : null;
      onRejectedBox?.({
        index,
        reason: validCoordinates ? 'non_positive_size' : 'invalid_coordinates',
        box: { left: coordinate('left'), top: coordinate('top'), right: coordinate('right'), bottom: coordinate('bottom') },
      });
      return;
    }
    boxes.push({ left: box.left / 1000, top: box.top / 1000, right: box.right / 1000, bottom: box.bottom / 1000 });
  });
  if (value.boxes.length > 0 && boxes.length === 0) throw new VlmResponseError('All VLM boxes were invalid. Keeping previous boxes.');
  return boxes;
}

export function parseVlmCompletion(value: unknown, onRejectedBox?: (rejection: VlmBoxRejection) => void): NormalizedBox[] {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    throw new VlmResponseError('Invalid VLM chat completion.');
  }
  const choice = value.choices[0];
  if (choice.finish_reason !== 'stop') throw new VlmResponseError('VLM output is incomplete. Expected finish_reason=stop.');
  if (!isRecord(choice.message) || typeof choice.message.content !== 'string' || !choice.message.content.trim()) {
    throw new VlmResponseError('VLM returned no content. Disable thinking in the model chat template and retry.');
  }
  let content: unknown;
  try {
    content = JSON.parse(choice.message.content);
  } catch {
    throw new VlmResponseError('VLM content was not valid JSON.');
  }
  return parseVlmBoxes(content, onRejectedBox);
}

export function createVlmRequest(model: VlmModel, object: string, image: string) {
  return {
    model,
    temperature: 0,
    max_tokens: 1024,
    stream: false,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        {
          type: 'text',
          text: `Find all distinct objects matching this description: ${JSON.stringify(object)}. ` +
            'Return a tight bounding box for each matching object, never a group. ' +
            'Use integer coordinates from 0 to 1000 relative to the full image. ' +
            'Return only JSON in this format: {"boxes":[{"left":100,"top":200,"right":300,"bottom":400}]}. ' +
            'If no matching objects are visible, return {"boxes":[]}. Return at most 20 boxes.',
        },
      ],
    }],
    response_format: { type: 'json_schema', json_schema: { name: 'object_boxes', strict: true, schema: vlmBoxSchema } },
  };
}
