import { JevProcessor } from './JevProcessor';
import { detectJevScrollBoxes } from './jevClient';
import type { FrameDetector } from './jevClient';

export class JevScroll extends JevProcessor {
  constructor(detect: FrameDetector = detectJevScrollBoxes, blockSize = 12) {
    super(detect, blockSize);
  }
}
