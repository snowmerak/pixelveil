import { JevProcessor } from './JevProcessor';
import { detectJevPanningBoxes } from './jevClient';
import type { FrameDetector } from './jevClient';

export class JevPanning extends JevProcessor {
  constructor(detect: FrameDetector = detectJevPanningBoxes, blockSize = 12) {
    super(detect, blockSize);
  }
}
