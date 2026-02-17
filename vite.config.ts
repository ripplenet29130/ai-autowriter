import path from 'path';
import { defineConfig, splitVendorChunkPlugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), splitVendorChunkPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase-vendor';
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'charts-vendor';
          }
          if (id.includes('node_modules/@dnd-kit')) {
            return 'dnd-vendor';
          }
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-')) {
            return 'markdown-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons-vendor';
          }
          if (
            id.includes('node_modules/date-fns') ||
            id.includes('node_modules/uuid') ||
            id.includes('node_modules/axios')
          ) {
            return 'utils-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
});
