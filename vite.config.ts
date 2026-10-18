import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { jevProxy } from './server/jevProxy.ts';
import { vlmProxy } from './server/vlmProxy.ts';
import { embeddingProxy } from './server/embeddingProxy.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), jevProxy({
      apiKey: env.TYPESAFE_API_KEY?.trim() ?? '',
      timeoutMs: Number(env.JEV_TIMEOUT_MS ?? 30000),
    }), vlmProxy({
      baseUrl: env.VLM_BASE_URL?.trim() || 'http://localhost:1234/v1',
      apiKey: env.VLM_API_KEY?.trim() ?? '',
      timeoutMs: Number(env.VLM_TIMEOUT_MS ?? 120000),
    }), embeddingProxy({
      baseUrl: env.EMBEDDING_BASE_URL?.trim() || 'http://localhost:12821/v1',
      model: env.EMBEDDING_MODEL?.trim() ?? 'embeddinggemma2',
      apiKey: env.EMBEDDING_API_KEY?.trim() ?? '',
      timeoutMs: Number(env.EMBEDDING_TIMEOUT_MS ?? 30000),
    })],
  };
});
