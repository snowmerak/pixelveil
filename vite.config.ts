import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { jevProxy } from './server/jevProxy.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), jevProxy({
      apiKey: env.TYPESAFE_API_KEY?.trim() ?? '',
      timeoutMs: Number(env.JEV_TIMEOUT_MS ?? 30000),
    })],
  };
});
