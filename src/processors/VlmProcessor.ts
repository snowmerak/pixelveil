import { AsyncDetectionProcessor } from './AsyncDetectionProcessor';
import type { FrameDetector } from './FrameDetector';
import { createVlmDetector } from './vlmClient';
import type { VlmModel } from './vlmProtocol';
import { VlmResponseError } from './vlmProtocol';

export class VlmProcessor extends AsyncDetectionProcessor {
  constructor(model: VlmModel, detect: FrameDetector = createVlmDetector(model), blockSize = 12) {
    super(detect, blockSize, 'VLM', { model });
  }

  protected isRecoverableError(error: unknown): boolean {
    return error instanceof VlmResponseError;
  }
}
