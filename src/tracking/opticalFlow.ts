import { getOpenCv } from './openCv';

export interface Point {
  x: number;
  y: number;
}

export interface GrayImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface PointMatch {
  before: Point;
  after: Point;
}

export interface SimilarityTransform {
  cosScale: number;
  sinScale: number;
  offsetX: number;
  offsetY: number;
}

const maxPoints = 32;

export function grayscaleFrame(frame: ImageData): GrayImage {
  const scale = Math.min(1, 320 / frame.width, 240 / frame.height);
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const pixels = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const sourceRow = Math.min(frame.height - 1, Math.floor((row + 0.5) * frame.height / height));
    for (let column = 0; column < width; column++) {
      const sourceColumn = Math.min(frame.width - 1, Math.floor((column + 0.5) * frame.width / width));
      const offset = (sourceRow * frame.width + sourceColumn) * 4;
      pixels[row * width + column] = Math.round((frame.data[offset] * 77 + frame.data[offset + 1] * 150 + frame.data[offset + 2] * 29) / 256);
    }
  }
  return { width, height, pixels };
}

function patchFits(image: GrayImage, point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 4 && point.y >= 4 && point.x < image.width - 5 && point.y < image.height - 5;
}

export function insidePolygon(point: Point, corners: readonly Point[]): boolean {
  let sign = 0;
  for (let index = 0; index < corners.length; index++) {
    const first = corners[index];
    const second = corners[(index + 1) % corners.length];
    const cross = (second.x - first.x) * (point.y - first.y) - (second.y - first.y) * (point.x - first.x);
    if (Math.abs(cross) < 0.001) continue;
    const nextSign = Math.sign(cross);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

export function findFeatures(image: GrayImage, corners: readonly Point[], retained: readonly Point[] = []): Point[] {
  const points = retained.filter((point) => patchFits(image, point) && insidePolygon(point, corners)).slice(0, maxPoints);
  if (points.length >= maxPoints) return points;
  const cv = getOpenCv();
  const resources: InstanceType<typeof cv.Mat>[] = [];
  try {
    const gray = new cv.Mat(image.height, image.width, cv.CV_8UC1);
    resources.push(gray);
    gray.data.set(image.pixels);
    const mask = cv.Mat.zeros(image.height, image.width, cv.CV_8UC1);
    resources.push(mask);
    const left = Math.max(4, Math.ceil(Math.min(...corners.map((point) => point.x))));
    const right = Math.min(image.width - 5, Math.floor(Math.max(...corners.map((point) => point.x))));
    const top = Math.max(4, Math.ceil(Math.min(...corners.map((point) => point.y))));
    const bottom = Math.min(image.height - 5, Math.floor(Math.max(...corners.map((point) => point.y))));
    for (let row = top; row < bottom; row++) {
      for (let column = left; column < right; column++) {
        const point = { x: column, y: row };
        if (insidePolygon(point, corners) && points.every((retainedPoint) => Math.hypot(retainedPoint.x - column, retainedPoint.y - row) >= 4)) {
          mask.data[row * image.width + column] = 255;
        }
      }
    }
    const detected = new cv.Mat();
    resources.push(detected);
    cv.goodFeaturesToTrack(gray, detected, maxPoints - points.length, 0.01, 4, mask, 3, false, 0.04);
    for (let index = 0; index < detected.rows; index++) {
      const point = { x: detected.data32F[index * 2], y: detected.data32F[index * 2 + 1] };
      if (patchFits(image, point) && insidePolygon(point, corners)) points.push(point);
    }
    return points;
  } finally {
    resources.forEach((resource) => resource.delete());
  }
}

export function followFeatures(previous: GrayImage, current: GrayImage, points: readonly Point[]): PointMatch[] {
  if (points.length === 0) return [];
  const cv = getOpenCv();
  const resources: InstanceType<typeof cv.Mat>[] = [];
  const create = (rows = 0, columns = 0, type = cv.CV_8UC1) => {
    const mat = rows > 0 ? new cv.Mat(rows, columns, type) : new cv.Mat();
    resources.push(mat);
    return mat;
  };
  try {
    const previousGray = create(previous.height, previous.width);
    previousGray.data.set(previous.pixels);
    const currentGray = create(current.height, current.width);
    currentGray.data.set(current.pixels);
    const sourcePoints = create(points.length, 1, cv.CV_32FC2);
    sourcePoints.data32F.set(points.flatMap((point) => [point.x, point.y]));
    const nextPoints = create();
    const status = create();
    const errors = create();
    const windowSize = new cv.Size(21, 21);
    const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 30, 0.01);
    cv.calcOpticalFlowPyrLK(previousGray, currentGray, sourcePoints, nextPoints, status, errors, windowSize, 3, criteria, 0, 1e-4);
    const forward: PointMatch[] = [];
    for (let index = 0; index < points.length; index++) {
      const after = { x: nextPoints.data32F[index * 2], y: nextPoints.data32F[index * 2 + 1] };
      if (status.data[index] && Number.isFinite(errors.data32F[index]) && errors.data32F[index] <= 30 && patchFits(current, after)) {
        forward.push({ before: points[index], after });
      }
    }
    if (forward.length === 0) return [];
    const backwardSource = create(forward.length, 1, cv.CV_32FC2);
    backwardSource.data32F.set(forward.flatMap((match) => [match.after.x, match.after.y]));
    const returnedPoints = create();
    const backwardStatus = create();
    const backwardErrors = create();
    cv.calcOpticalFlowPyrLK(currentGray, previousGray, backwardSource, returnedPoints, backwardStatus, backwardErrors, windowSize, 3, criteria, 0, 1e-4);
    return forward.filter((match, index) => {
      return backwardStatus.data[index] && Number.isFinite(backwardErrors.data32F[index]) && backwardErrors.data32F[index] <= 30 &&
        Math.hypot(returnedPoints.data32F[index * 2] - match.before.x, returnedPoints.data32F[index * 2 + 1] - match.before.y) <= 1;
    });
  } finally {
    resources.forEach((resource) => resource.delete());
  }
}

export function transformPoint(point: Point, transform: SimilarityTransform): Point {
  return {
    x: transform.cosScale * point.x - transform.sinScale * point.y + transform.offsetX,
    y: transform.sinScale * point.x + transform.cosScale * point.y + transform.offsetY,
  };
}

export function estimateMotion(matches: readonly PointMatch[]): { transform: SimilarityTransform; inliers: PointMatch[] } | null {
  if (matches.length < 4) return null;
  let best: PointMatch[] = [];
  let attempts = 0;
  for (let firstIndex = 0; firstIndex < matches.length && attempts < 96; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < matches.length && attempts < 96; secondIndex++) {
      const first = matches[firstIndex];
      const second = matches[secondIndex];
      const beforeX = second.before.x - first.before.x;
      const beforeY = second.before.y - first.before.y;
      const afterX = second.after.x - first.after.x;
      const afterY = second.after.y - first.after.y;
      const energy = beforeX * beforeX + beforeY * beforeY;
      if (energy < 16) continue;
      attempts++;
      const cosScale = (beforeX * afterX + beforeY * afterY) / energy;
      const sinScale = (beforeX * afterY - beforeY * afterX) / energy;
      const transform = {
        cosScale, sinScale,
        offsetX: first.after.x - cosScale * first.before.x + sinScale * first.before.y,
        offsetY: first.after.y - sinScale * first.before.x - cosScale * first.before.y,
      };
      const scale = Math.hypot(cosScale, sinScale);
      if (scale < 0.75 || scale > 1.33 || Math.abs(Math.atan2(sinScale, cosScale)) > Math.PI / 6) continue;
      const inliers = matches.filter((match) => {
        const predicted = transformPoint(match.before, transform);
        return Math.hypot(predicted.x - match.after.x, predicted.y - match.after.y) <= 1.5;
      });
      if (inliers.length > best.length) best = inliers;
    }
  }
  if (best.length < 4 || best.length < matches.length * 0.5) return null;
  const mean = (side: 'before' | 'after'): Point => ({
    x: best.reduce((sum, match) => sum + match[side].x, 0) / best.length,
    y: best.reduce((sum, match) => sum + match[side].y, 0) / best.length,
  });
  const beforeMean = mean('before');
  const afterMean = mean('after');
  let energy = 0;
  let dot = 0;
  let cross = 0;
  for (const match of best) {
    const beforeX = match.before.x - beforeMean.x;
    const beforeY = match.before.y - beforeMean.y;
    const afterX = match.after.x - afterMean.x;
    const afterY = match.after.y - afterMean.y;
    energy += beforeX * beforeX + beforeY * beforeY;
    dot += beforeX * afterX + beforeY * afterY;
    cross += beforeX * afterY - beforeY * afterX;
  }
  if (energy === 0) return null;
  const cosScale = dot / energy;
  const sinScale = cross / energy;
  const scale = Math.hypot(cosScale, sinScale);
  if (scale < 0.75 || scale > 1.33 || Math.abs(Math.atan2(sinScale, cosScale)) > Math.PI / 6) return null;
  return {
    transform: {
      cosScale, sinScale,
      offsetX: afterMean.x - cosScale * beforeMean.x + sinScale * beforeMean.y,
      offsetY: afterMean.y - sinScale * beforeMean.x - cosScale * beforeMean.y,
    },
    inliers: best,
  };
}
