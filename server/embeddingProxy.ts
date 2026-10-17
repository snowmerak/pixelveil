import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { parseEmbeddingResponse } from '../src/processors/embeddingProtocol.ts';

interface EmbeddingProxyOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

function isFrameImage(value: unknown): value is string {
  if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const image = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
  if (image.length < 33 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      image.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  return width > 0 && width <= 320 && height > 0 && height <= 320;
}

export function embeddingProxy({ baseUrl, model, apiKey, timeoutMs }: EmbeddingProxyOptions): Plugin {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('EMBEDDING_BASE_URL must be an HTTP(S) API base URL without credentials, query or fragment.');
  }
  if (!model.trim()) throw new Error('EMBEDDING_MODEL must not be empty.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('EMBEDDING_TIMEOUT_MS must be a positive safe integer.');
  const endpoint = `${baseUrl.replace(/\/+$/, '')}`;
  const headers = { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  let modelVerified = false;

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const sendError = (status: number, message: string) => {
      if (response.destroyed || response.headersSent) return;
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: message }));
    };
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendError(405, 'POST required.');
      return;
    }
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
      sendError(403, 'Same-origin requests required.');
      return;
    }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      sendError(415, 'JSON required.');
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', abort);
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 1024 * 1024) {
          sendError(413, 'Request exceeds 1 MiB.');
          return;
        }
        chunks.push(buffer);
      }
      controller.signal.throwIfAborted();
      let input: unknown;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        sendError(400, 'Invalid JSON.');
        return;
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 1) {
        sendError(400, 'Expected exactly one text or image input.');
        return;
      }
      const text = 'text' in input && typeof input.text === 'string' ? input.text.trim() : null;
      const image = 'image' in input && isFrameImage(input.image) ? input.image : null;
      if ((!text || text.length > 2000) && !image) {
        sendError(400, 'Expected nonempty text up to 2000 characters or a PNG frame up to 320×320.');
        return;
      }
      if (!modelVerified) {
        const catalogResponse = await fetch(`${endpoint}/models`, { headers, signal: controller.signal });
        if (!catalogResponse.ok) {
          await catalogResponse.body?.cancel();
          sendError(502, 'Unable to discover embedding models.');
          return;
        }
        const catalog = await catalogResponse.json() as { data?: unknown[] };
        const supported = Array.isArray(catalog?.data) && catalog.data.some((entry) => {
          if (typeof entry !== 'object' || entry === null) return false;
          const candidate = entry as Record<string, unknown>;
          return candidate.id === model && candidate.task === 'embedding' && Array.isArray(candidate.input_modalities) &&
            candidate.input_modalities.includes('text') && candidate.input_modalities.includes('image');
        });
        if (!supported) {
          sendError(503, 'The configured embedding model must support text and image inputs.');
          return;
        }
        modelVerified = true;
      }
      const result = await fetch(`${endpoint}/embeddings`, {
        method: 'POST', headers,
        body: JSON.stringify({
          model, encoding_format: 'float',
          input: image ? { image } : text,
          ...(image ? {} : { input_type: 'query' }),
        }),
        signal: controller.signal,
      });
      if (!result.ok) {
        await result.body?.cancel();
        sendError(result.status === 503 ? 502 : result.status, 'The embedding server rejected the request.');
        return;
      }
      const body: unknown = await result.json();
      const embedding = parseEmbeddingResponse(body);
      if (embedding.model !== model) {
        sendError(502, 'Embedding response model does not match the configured model.');
        return;
      }
      if (response.destroyed) return;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    } catch {
      sendError(controller.signal.aborted ? 504 : 502, 'Embedding request failed.');
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abort);
      response.off('close', abort);
    }
  };

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/embedding') return next();
    void handle(request, response).catch(() => {
      if (!response.destroyed && !response.headersSent) {
        response.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'Invalid request.' }));
      }
    });
  };
  return {
    name: 'pixelveil-embedding-proxy',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
