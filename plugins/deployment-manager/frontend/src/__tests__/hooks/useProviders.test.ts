import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProviders, useGpuOptions } from '../../hooks/useProviders';

const mockProviders = [
  { slug: 'fal-ai', displayName: 'fal.ai', description: 'GPU', icon: '⚡', mode: 'serverless', authMethod: 'api-key', secretNames: ['api-key'] },
  { slug: 'ssh-bridge', displayName: 'SSH Bridge', description: 'SSH', icon: '🖥', mode: 'ssh-bridge', authMethod: 'ssh-key', secretNames: [] },
];

const mockGpuOptions = [
  { id: 'A100', name: 'NVIDIA A100', vramGb: 80, available: true },
  { id: 'T4', name: 'NVIDIA T4', vramGb: 16, available: true },
];

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useProviders', () => {
  it('should fetch provider list on mount', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      json: async () => ({ success: true, data: mockProviders }),
    });
    const { result } = renderHook(() => useProviders());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.providers).toHaveLength(2);
    expect(result.current.providers[0].slug).toBe('fal-ai');
  });

  it('should handle fetch failure gracefully', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useProviders());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.providers).toEqual([]);
  });
});

describe('useGpuOptions', () => {
  it('should fetch GPU options when provider slug is provided', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      json: async () => ({ success: true, data: mockGpuOptions }),
    });
    const { result } = renderHook(() => useGpuOptions('fal-ai'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gpuOptions).toHaveLength(2);
  });

  it('should clear options when slug is null', () => {
    const { result } = renderHook(() => useGpuOptions(null));
    expect(result.current.gpuOptions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('should handle fetch error', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useGpuOptions('runpod'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gpuOptions).toEqual([]);
  });
});
