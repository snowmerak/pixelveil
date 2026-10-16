import { mosaicRegion } from '../helpers/mosaic';
import type { Processor } from './Processor';
import { detectJevBoxes } from './jevClient';
import type { FrameDetector, NormalizedBox } from './jevClient';

export class JevSimple implements Processor {
  private object = '';
  private generation = 0;
  private boxes: NormalizedBox[] = [];
  private pending: AbortController | null = null;
  private failure: Error | null = null;
  private width = 0;
  private height = 0;
  private readonly detect: FrameDetector;
  private readonly blockSize: number;

  constructor(detect: FrameDetector = detectJevBoxes, blockSize = 12) {
    if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
      throw new RangeError('blockSize must be a positive safe integer.');
    }
    this.detect = detect;
    this.blockSize = blockSize;
  }

  process(inputFrame: ImageData, object: string): ImageData {
    const description = object.trim();
    if (description !== this.object || inputFrame.width !== this.width || inputFrame.height !== this.height) {
      this.reset();
      this.object = description;
      this.width = inputFrame.width;
      this.height = inputFrame.height;
    }
    if (!description) return inputFrame;
    if (this.failure) throw this.failure;

    if (!this.pending) {
      const controller = new AbortController();
      const generation = this.generation;
      this.pending = controller;
      void this.request(inputFrame, description, controller, generation);
    }

    return mosaicRegion(inputFrame, this.boxes.map((box) => ({
      x: box.left * inputFrame.width,
      y: box.top * inputFrame.height,
      width: (box.right - box.left) * inputFrame.width,
      height: (box.bottom - box.top) * inputFrame.height,
    })), this.blockSize);
  }

  reset(): void {
    this.generation++;
    this.pending?.abort();
    this.boxes = [];
    this.failure = null;
    this.object = '';
    this.width = 0;
    this.height = 0;
  }

  private async request(frame: ImageData, object: string, controller: AbortController, generation: number) {
    try {
      const boxes = await this.detect(frame, object, controller.signal);
      if (generation === this.generation && !controller.signal.aborted) this.boxes = boxes;
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) {
        this.failure = error instanceof Error ? error : new Error('Jev detection failed.');
      }
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
