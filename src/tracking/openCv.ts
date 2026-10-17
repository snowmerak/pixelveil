import type * as OpenCv from '@techstark/opencv-js';

let runtime: typeof OpenCv | null = null;
let initialization: Promise<{ cv: typeof OpenCv }> | null = null;

export function isOpenCvReady(): boolean {
  return runtime !== null;
}

export function getOpenCv(): typeof OpenCv {
  if (!runtime) throw new Error('OpenCV.js is not initialized.');
  return runtime;
}

export function loadOpenCv(): Promise<{ cv: typeof OpenCv }> {
  initialization ??= initializeOpenCv();
  return initialization;
}

async function initializeOpenCv(): Promise<{ cv: typeof OpenCv }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = await Promise.race([
      (async () => {
        const module = await import('./openCvModule');
        const loaded = module.getOpenCvModule().cv;
        const cv = loaded instanceof Promise ? await loaded : loaded;
        if (!cv.Mat) {
          await new Promise<void>((resolve) => { cv.onRuntimeInitialized = resolve; });
        }
        if (typeof cv.calcOpticalFlowPyrLK !== 'function' || typeof cv.goodFeaturesToTrack !== 'function') {
          throw new Error('The OpenCV.js build does not provide optical flow.');
        }
        return { cv };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('OpenCV.js initialization timed out. Reload or disable motion tracking.')), 30000);
      }),
    ]);
    runtime = loaded.cv;
    return loaded;
  } catch (error) {
    throw new Error('Unable to initialize OpenCV.js. Reload or disable motion tracking.', { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}
