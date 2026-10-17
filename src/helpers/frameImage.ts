export function encodeFrameDataUrl(frame: ImageData, maxWidth: number, maxHeight: number) {
  const source = document.createElement('canvas');
  source.width = frame.width;
  source.height = frame.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Canvas 2D rendering is unavailable.');
  sourceContext.putImageData(frame, 0, 0);

  const scale = Math.min(1, maxWidth / frame.width, maxHeight / frame.height);
  const image = document.createElement('canvas');
  image.width = Math.max(1, Math.round(frame.width * scale));
  image.height = Math.max(1, Math.round(frame.height * scale));
  const context = image.getContext('2d');
  if (!context) throw new Error('Canvas 2D rendering is unavailable.');
  context.drawImage(source, 0, 0, image.width, image.height);
  return { image: image.toDataURL('image/png'), width: image.width, height: image.height };
}
