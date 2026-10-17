export interface EmbeddingVector {
  model: string;
  values: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseEmbeddingResponse(value: unknown): EmbeddingVector {
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim() ||
      !Array.isArray(value.data) || value.data.length !== 1 || !isRecord(value.data[0])) {
    throw new Error('Invalid embedding response.');
  }
  const item = value.data[0];
  if (item.index !== 0 || !Array.isArray(item.embedding) || item.embedding.length === 0 || item.embedding.length > 8192 ||
      !item.embedding.every((coordinate: unknown) => typeof coordinate === 'number' && Number.isFinite(coordinate))) {
    throw new Error('Invalid embedding vector.');
  }
  const values = item.embedding as number[];
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding vector must have a finite, positive norm.');
  return { model: value.model, values };
}

export function cosineSimilarity(first: readonly number[], second: readonly number[]): number {
  if (first.length === 0 || first.length !== second.length ||
      !first.every(Number.isFinite) || !second.every(Number.isFinite)) {
    throw new Error('Embedding vectors must have equal, nonzero dimensions and finite coordinates.');
  }
  const firstNorm = Math.hypot(...first);
  const secondNorm = Math.hypot(...second);
  if (!Number.isFinite(firstNorm) || !Number.isFinite(secondNorm) || firstNorm === 0 || secondNorm === 0) {
    throw new Error('Embedding vectors must have finite, positive norms.');
  }
  let similarity = 0;
  for (let index = 0; index < first.length; index++) similarity += (first[index] / firstNorm) * (second[index] / secondNorm);
  return Math.max(-1, Math.min(1, similarity));
}
