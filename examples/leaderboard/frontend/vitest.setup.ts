import { vi } from 'vitest';
import '@testing-library/jest-dom';

if (typeof globalThis.jest === 'undefined') {
  (globalThis as Record<string, unknown>).jest = {
    fn: vi.fn,
    spyOn: vi.spyOn,
    mock: vi.mock,
  };
}

globalThis.fetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ success: true, data: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
);
