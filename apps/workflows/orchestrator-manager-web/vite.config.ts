import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@naap/ui': path.resolve(__dirname, '../../../packages/ui/src'),
      '@naap/types': path.resolve(__dirname, '../../../packages/types/src'),
      '@naap/theme': path.resolve(__dirname, '../../../packages/theme/src'),
      '@naap/utils': path.resolve(__dirname, '../../../packages/utils/src'),
    },
  },
  server: { port: 3002, host: '0.0.0.0' },
  build: { modulePreload: false, target: 'esnext', minify: false, cssCodeSplit: false },
});
