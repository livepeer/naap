import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@naap/plugin-sdk': path.resolve(__dirname, '../../../packages/plugin-sdk/src'),
      '@naap/plugin-sdk/testing': path.resolve(__dirname, '../../../packages/plugin-sdk/src/testing'),
      // Deduplicate React — ensure only one copy is used across plugin + SDK
      'react': path.resolve(__dirname, '../../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../../node_modules/react-dom'),
      'react-dom/client': path.resolve(__dirname, '../../../node_modules/react-dom/client'),
      'react/jsx-runtime': path.resolve(__dirname, '../../../node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve(__dirname, '../../../node_modules/react/jsx-dev-runtime'),
      'react-router-dom': path.resolve(__dirname, '../../../node_modules/react-router-dom'),
      'react-router': path.resolve(__dirname, '../../../node_modules/react-router'),
    },
  },
});
