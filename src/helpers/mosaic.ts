export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function mosaicRegion(frame: ImageData, bboxes: readonly BoundingBox[], blockSize = 12): ImageData {
  if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
    throw new RangeError('blockSize must be a positive safe integer.');
  }

  for (const bbox of bboxes) {
    if (![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) {
      throw new RangeError('Bounding box coordinates and dimensions must be finite.');
    }
  }

  for (const bbox of bboxes) {
    applyMosaicRegion(frame, bbox, blockSize);
  }

  return frame;
}

function applyMosaicRegion(frame: ImageData, bbox: BoundingBox, blockSize: number): void {
  if (bbox.width <= 0 || bbox.height <= 0) return;

  const left = Math.max(0, Math.floor(bbox.x));
  const top = Math.max(0, Math.floor(bbox.y));
  const right = Math.min(frame.width, Math.ceil(bbox.x + bbox.width));
  const bottom = Math.min(frame.height, Math.ceil(bbox.y + bbox.height));
  if (left >= right || top >= bottom) return;

  const { data, width } = frame;

  for (let blockY = top; blockY < bottom; blockY += blockSize) {
    const blockBottom = Math.min(blockY + blockSize, bottom);

    for (let blockX = left; blockX < right; blockX += blockSize) {
      const blockRight = Math.min(blockX + blockSize, right);
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let pixelY = blockY; pixelY < blockBottom; pixelY++) {
        for (let pixelX = blockX; pixelX < blockRight; pixelX++) {
          const offset = (pixelY * width + pixelX) * 4;
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
        }
      }

      const pixelCount = (blockRight - blockX) * (blockBottom - blockY);
      const averageRed = Math.round(red / pixelCount);
      const averageGreen = Math.round(green / pixelCount);
      const averageBlue = Math.round(blue / pixelCount);

      for (let pixelY = blockY; pixelY < blockBottom; pixelY++) {
        for (let pixelX = blockX; pixelX < blockRight; pixelX++) {
          const offset = (pixelY * width + pixelX) * 4;
          data[offset] = averageRed;
          data[offset + 1] = averageGreen;
          data[offset + 2] = averageBlue;
        }
      }
    }
  }
}
