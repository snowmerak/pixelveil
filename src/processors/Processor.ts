export interface Processor {
  process(inputFrame: ImageData, object: string): ImageData;
}
