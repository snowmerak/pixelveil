import { parseEmbeddingResponse } from './embeddingProtocol';
import type { EmbeddingVector } from './embeddingProtocol';

export async function requestEmbedding(input: { text: string } | { image: string }, signal: AbortSignal): Promise<EmbeddingVector> {
  signal.throwIfAborted();
  const response = await fetch('/api/embedding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error(`Embedding request failed (HTTP ${response.status}).`);
  const result = parseEmbeddingResponse(await response.json());
  signal.throwIfAborted();
  return result;
}
