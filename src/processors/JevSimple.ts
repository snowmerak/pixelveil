import { JevProcessor } from './JevProcessor';
import { detectJevBoxes } from './jevClient';
import type { FrameDetector } from './jevClient';

export class JevSimple extends JevProcessor {
  constructor(detect: FrameDetector = detectJevBoxes, blockSize = 12) {
    super(detect, blockSize);
  }
}
