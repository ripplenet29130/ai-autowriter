import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@aw/config': path.resolve(__dirname, './packages/config/src/index.ts'),
      '@aw/types': path.resolve(__dirname, './packages/types/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api-serp': {
        target: 'https://serpapi.com',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api-serp/, '/search.json'),
      },
      '/api-google': {
        target: 'https://www.googleapis.com',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api-google/, '/customsearch/v1'),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    reportCompressedSize: false,
    emptyOutDir: true,
  },
});
