import { describe, it, expect } from 'vitest';
import { normalizePluginName } from '../normalize.js';

describe('normalizePluginName', () => {
  it('lowercases the input', () => {
    expect(normalizePluginName('MyPlugin')).toBe('myplugin');
  });

  it('strips hyphens', () => {
    expect(normalizePluginName('my-plugin')).toBe('myplugin');
  });

  it('strips underscores', () => {
    expect(normalizePluginName('my_plugin')).toBe('myplugin');
  });

  it('handles mixed case + hyphens + underscores', () => {
    expect(normalizePluginName('My-Cool_Plugin')).toBe('mycoolplugin');
  });

  it('already normalized names pass through unchanged', () => {
    expect(normalizePluginName('myplugin')).toBe('myplugin');
  });

  it('different naming conventions produce the same normalized form', () => {
    expect(normalizePluginName('my-plugin')).toBe(normalizePluginName('myPlugin'));
    expect(normalizePluginName('myPlugin')).toBe(normalizePluginName('MY_PLUGIN'));
    expect(normalizePluginName('my-plugin')).toBe(normalizePluginName('MY_PLUGIN'));
  });
});
