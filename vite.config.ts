/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@citadel/app-chat/client', replacement: fileURLToPath(new URL('./packages/apps/chat/client.ts', import.meta.url)) },
      { find: '@citadel/app-chat/server', replacement: fileURLToPath(new URL('./packages/apps/chat/server.ts', import.meta.url)) },
      { find: '@citadel/app-chat/validation', replacement: fileURLToPath(new URL('./packages/apps/chat/validation.ts', import.meta.url)) },
      { find: '@citadel/app-chess/client', replacement: fileURLToPath(new URL('./packages/apps/chess/client.ts', import.meta.url)) },
      { find: '@citadel/app-chess/server', replacement: fileURLToPath(new URL('./packages/apps/chess/server.ts', import.meta.url)) },
      { find: '@citadel/app-snake/client', replacement: fileURLToPath(new URL('./packages/apps/snake/client.ts', import.meta.url)) },
      { find: '@citadel/app-snake/server', replacement: fileURLToPath(new URL('./packages/apps/snake/server.ts', import.meta.url)) },
      { find: '@citadel/platform/server-app', replacement: fileURLToPath(new URL('./packages/platform/server-app.ts', import.meta.url)) },
      { find: '@citadel/platform/validation', replacement: fileURLToPath(new URL('./packages/platform/validation.ts', import.meta.url)) },
      { find: '@citadel/platform/server', replacement: fileURLToPath(new URL('./packages/platform/server.ts', import.meta.url)) },
      { find: '@citadel/platform/persistence', replacement: fileURLToPath(new URL('./packages/platform/persistence.ts', import.meta.url)) },
      { find: '@citadel/platform/client', replacement: fileURLToPath(new URL('./packages/platform/client.ts', import.meta.url)) },
      { find: '@citadel/platform/app', replacement: fileURLToPath(new URL('./packages/platform/app.ts', import.meta.url)) },
      { find: '@citadel/app-chat', replacement: fileURLToPath(new URL('./packages/apps/chat/index.ts', import.meta.url)) },
      { find: '@citadel/app-chess', replacement: fileURLToPath(new URL('./packages/apps/chess/index.ts', import.meta.url)) },
      { find: '@citadel/app-snake', replacement: fileURLToPath(new URL('./packages/apps/snake/index.ts', import.meta.url)) }
    ]
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      },
      '/health': 'http://localhost:3001'
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']
  }
});
