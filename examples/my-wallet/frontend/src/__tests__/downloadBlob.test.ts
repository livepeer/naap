import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob } from '../lib/utils.js';

describe('downloadBlob', () => {
  let mockAnchor: Record<string, unknown>;
  let appendChildSpy: ReturnType<typeof vi.fn>;
  let removeChildSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };

    appendChildSpy = vi.fn();
    removeChildSpy = vi.fn();

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockAnchor),
      body: {
        appendChild: appendChildSpy,
        removeChild: removeChildSpy,
      },
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an anchor element', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    downloadBlob(blob, 'test.txt');

    expect(document.createElement).toHaveBeenCalledWith('a');
  });

  it('sets correct href from object URL', () => {
    const blob = new Blob(['data'], { type: 'text/csv' });
    downloadBlob(blob, 'report.csv');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(mockAnchor.href).toBe('blob:mock-url');
  });

  it('sets the download attribute to the filename', () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    downloadBlob(blob, 'export.json');

    expect(mockAnchor.download).toBe('export.json');
  });

  it('appends to body, clicks, then removes', () => {
    const blob = new Blob(['x']);
    downloadBlob(blob, 'file.bin');

    expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor);

    const appendOrder = appendChildSpy.mock.invocationCallOrder[0];
    const clickOrder = (mockAnchor.click as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const removeOrder = removeChildSpy.mock.invocationCallOrder[0];
    expect(appendOrder).toBeLessThan(clickOrder);
    expect(clickOrder).toBeLessThan(removeOrder);
  });

  it('revokes the object URL after download', () => {
    const blob = new Blob(['cleanup']);
    downloadBlob(blob, 'temp.txt');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
