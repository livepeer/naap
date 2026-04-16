import { describe, it, expect } from 'vitest';
import { generateSnippets } from '../snippets.js';
import { CAPABILITY_CATEGORIES } from '../types.js';

describe('snippets', () => {
  it('generates all three snippet types', () => {
    const snippet = generateSnippets('text-to-image', 't2i', 'stabilityai/sd-turbo');
    expect(snippet.curl).toBeTruthy();
    expect(snippet.python).toBeTruthy();
    expect(snippet.javascript).toBeTruthy();
  });

  it('includes model ID in snippets', () => {
    const snippet = generateSnippets('text-to-image', 't2i', 'stabilityai/sd-turbo');
    expect(snippet.curl).toContain('stabilityai/sd-turbo');
    expect(snippet.python).toContain('stabilityai/sd-turbo');
    expect(snippet.javascript).toContain('stabilityai/sd-turbo');
  });

  it('includes gateway base URL', () => {
    const snippet = generateSnippets('llm', 'llm', 'meta-llama/Llama-3');
    expect(snippet.curl).toContain('dream-gateway.livepeer.cloud');
  });

  it('generates valid snippets for every category', () => {
    for (const cat of CAPABILITY_CATEGORIES) {
      const snippet = generateSnippets(`test-${cat}`, cat, 'test-model');
      expect(snippet.curl).toBeTruthy();
      expect(snippet.python).toBeTruthy();
      expect(snippet.javascript).toBeTruthy();
    }
  });

  it('uses YOUR_MODEL_ID when no model provided', () => {
    const snippet = generateSnippets('text-to-image', 't2i');
    expect(snippet.curl).toContain('YOUR_MODEL_ID');
  });
});
