/**
 * Vitest Setup File
 *
 * This file is executed before each test file.
 * It sets up global mocks and testing utilities.
 */

import { vi } from 'vitest';

// Mock jest global for compatibility with existing tests
if (typeof globalThis.jest === 'undefined') {
  (globalThis as unknown as { jest: typeof vi }).jest = vi;
}

// Mock window.matchMedia for theme tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  root = null;
  rootMargin = '';
  thresholds = [];
}
(globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverMock }).IntersectionObserver =
  IntersectionObserverMock;

// Suppress console errors in tests unless explicitly testing errors
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  // Filter out React-specific warnings during tests
  const message = args[0];
  if (
    typeof message === 'string' &&
    (message.includes('Warning: ReactDOM.render') ||
      message.includes('Warning: An update to') ||
      message.includes('act(...)'))
  ) {
    return;
  }
  originalConsoleError(...args);
};

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});
