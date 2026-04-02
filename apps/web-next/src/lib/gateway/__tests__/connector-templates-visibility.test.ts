import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    gatewayConnectorTemplate: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import { loadConnectorTemplates } from '../connector-templates';

const makeTemplate = (id: string, name: string, visible = true) => ({
  id,
  name,
  description: `${name} connector`,
  icon: 'Globe',
  category: 'ai',
  connector: { slug: id, displayName: name, authType: 'bearer', secretRefs: [] },
  endpoints: [{ name: 'default', method: 'POST', path: '/', upstreamPath: '/' }],
  source: 'builtin',
  visibleToUsers: visible,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('loadConnectorTemplates visibility', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('returns all templates when visibleOnly is not set', async () => {
    mockFindMany.mockResolvedValue([
      makeTemplate('t1', 'OpenAI', true),
      makeTemplate('t2', 'Hidden Service', false),
    ]);

    const result = await loadConnectorTemplates();

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(2);
  });

  it('filters to visible-only when visibleOnly is true', async () => {
    mockFindMany.mockResolvedValue([
      makeTemplate('t1', 'OpenAI', true),
    ]);

    const result = await loadConnectorTemplates({ visibleOnly: true });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { visibleToUsers: true },
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('OpenAI');
  });

  it('returns all templates when visibleOnly is false', async () => {
    mockFindMany.mockResolvedValue([
      makeTemplate('t1', 'OpenAI', true),
      makeTemplate('t2', 'Hidden Service', false),
    ]);

    const result = await loadConnectorTemplates({ visibleOnly: false });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(2);
  });
});
