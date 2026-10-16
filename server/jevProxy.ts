import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

interface JevProxyOptions {
  apiKey: string;
  timeoutMs: number;
}

export function jevProxy({ apiKey, timeoutMs }: JevProxyOptions): Plugin {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('JEV_TIMEOUT_MS must be a positive safe integer.');
  }

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const sendError = (status: number, message: string) => {
      if (response.destroyed) return;
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
    if (!apiKey) {
      sendError(503, 'TYPESAFE_API_KEY is not configured.');
      return;
    }
    const contentType = request.headers['content-type'];
    if (!contentType?.startsWith('multipart/form-data;')) {
      sendError(415, 'Multipart form data required.');
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
        if (size > 32 * 1024 * 1024) {
          sendError(413, 'Request exceeds 32 MiB.');
          return;
        }
        chunks.push(buffer);
      }
      controller.signal.throwIfAborted();
      const result = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'TypeSafe-Danger-Zone-Images': 'true',
          'Content-Type': contentType,
        },
        body: new Uint8Array(Buffer.concat(chunks)),
        signal: controller.signal,
      });
      const body = await result.text();
      if (result.ok) {
        response.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(body);
      } else {
        sendError(result.status === 503 ? 502 : result.status, 'Jev rejected the request.');
      }
    } catch {
      sendError(controller.signal.aborted ? 504 : 502, 'Jev request failed.');
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abort);
      response.off('close', abort);
    }
  };

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/jev') return next();
    void handle(request, response).catch(() => {
      if (!response.destroyed && !response.headersSent) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Invalid request.' }));
      }
    });
  };

  return {
    name: 'pixelveil-jev-proxy',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
