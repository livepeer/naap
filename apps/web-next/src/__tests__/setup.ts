import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock Next.js image component
vi.mock('next/image', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  default: function MockImage(props: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createElement } = require('react');
    return createElement('img', props);
  },
}));

// Mock fetch for API tests
global.fetch = vi.fn();

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Clean up after tests
afterEach(() => {
  vi.restoreAllMocks();
});
