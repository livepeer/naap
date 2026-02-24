import { vi } from 'vitest';
import '@testing-library/jest-dom';

// MockShellProvider from @naap/plugin-sdk uses jest.fn() directly.
// Polyfill the jest global so it works under vitest.
if (typeof globalThis.jest === 'undefined') {
  (globalThis as Record<string, unknown>).jest = {
    fn: vi.fn,
    spyOn: vi.spyOn,
    mock: vi.mock,
  };
}

// Stub fetch so that components mounting in tests don't produce
// unhandled ECONNREFUSED rejections (no dev server running).
globalThis.fetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ success: true, data: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
);
