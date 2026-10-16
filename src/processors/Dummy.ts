import type { Processor } from './Processor';

export class Dummy implements Processor {
  process(inputFrame: ImageData, object: string): ImageData {
    void object;
    return inputFrame;
  }
}
