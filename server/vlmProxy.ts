import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { createVlmRequest, isVlmModel } from '../src/processors/vlmProtocol.ts';

interface VlmProxyOptions {
  baseUrl: string;
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
  return width > 0 && width <= 1280 && height > 0 && height <= 720;
}

export function vlmProxy({ baseUrl, apiKey, timeoutMs }: VlmProxyOptions): Plugin {
  const endpoint = new URL(`${baseUrl.replace(/\/+$/, '')}/chat/completions`);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('VLM_BASE_URL must be an HTTP(S) API base URL without credentials, query or fragment.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('VLM_TIMEOUT_MS must be a positive safe integer.');

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
        if (size > 8 * 1024 * 1024) {
          sendError(413, 'Request exceeds 8 MiB.');
          return;
        }
        chunks.push(buffer);
      }
      controller.signal.throwIfAborted();
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        sendError(400, 'Invalid JSON.');
        return;
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input) ||
          !('model' in input) || !isVlmModel(input.model) ||
          !('object' in input) || typeof input.object !== 'string' || !input.object.trim() || input.object.length > 2000 ||
          !('image' in input) || !isFrameImage(input.image) || Object.keys(input).length !== 3) {
        sendError(400, 'Expected a supported model, object description and PNG frame up to 1280×720.');
        return;
      }
      const result = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(createVlmRequest(input.model, input.object.trim(), input.image)),
        signal: controller.signal,
      });
      if (!result.ok) {
        await result.body?.cancel();
        sendError(result.status === 503 ? 502 : result.status, 'The VLM server rejected the request.');
        return;
      }
      const body = await result.text();
      if (response.destroyed) return;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      sendError(controller.signal.aborted ? 504 : 502, 'VLM request failed.');
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abort);
      response.off('close', abort);
    }
  };

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/vlm') return next();
    void handle(request, response).catch(() => {
      if (!response.destroyed && !response.headersSent) {
        response.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'Invalid request.' }));
      }
    });
  };
  return {
    name: 'pixelveil-vlm-proxy',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
