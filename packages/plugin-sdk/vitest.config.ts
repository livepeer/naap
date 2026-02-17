import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
      'cli/**/*.test.{ts,tsx}',
      'cli/**/*.spec.{ts,tsx}',
    ],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./src/testing/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'html'],
      exclude: [
        'node_modules/',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'cli/**/*.test.{ts,tsx}',
        'cli/**/*.spec.{ts,tsx}',
        'src/**/*.d.ts',
        'src/testing/**',
      ],
      thresholds: {
        global: {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
      },
    },
  },
});
