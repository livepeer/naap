import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, getLocale, loadLocale, resolveLocale } from '../core.js';

describe('core i18n', () => {
  beforeEach(() => {
    // Reset to known state before each test
    setLocale('en');
    loadLocale('en', {
      greeting: 'Hello',
      farewell: 'Goodbye',
      welcome: 'Welcome, {name}!',
      invoice_total: 'Total: {amount} ({count} items)',
      expense: {
        receipt_saved: 'Receipt saved for {amount}',
        category: 'Category',
      },
    });
    loadLocale('fr', {
      greeting: 'Bonjour',
      farewell: 'Au revoir',
      welcome: 'Bienvenue, {name} !',
      expense: {
        receipt_saved: 'Re\u00e7u enregistr\u00e9 pour {amount}',
        category: 'Cat\u00e9gorie',
      },
    });
  });

  describe('t()', () => {
    it('returns translated string for an existing key', () => {
      expect(t('greeting')).toBe('Hello');
    });

    it('replaces {param} placeholders with interpolation values', () => {
      expect(t('welcome', { name: 'Alice' })).toBe('Welcome, Alice!');
    });

    it('handles multiple interpolation params', () => {
      expect(t('invoice_total', { amount: '$45.00', count: 3 })).toBe(
        'Total: $45.00 (3 items)',
      );
    });

    it('leaves unmatched placeholders intact when param is missing', () => {
      expect(t('welcome')).toBe('Welcome, {name}!');
    });

    it('resolves dot-notation keys to nested objects', () => {
      expect(t('expense.receipt_saved', { amount: '$45.00' })).toBe(
        'Receipt saved for $45.00',
      );
      expect(t('expense.category')).toBe('Category');
    });

    it('falls back to fallback locale when current locale is missing the key', () => {
      setLocale('fr');
      // 'invoice_total' only exists in 'en', not in 'fr'
      expect(t('invoice_total', { amount: '45 $', count: 3 })).toBe(
        'Total: 45 $ (3 items)',
      );
    });

    it('returns the key itself when no locale has a translation', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });
  });

  describe('setLocale() / getLocale()', () => {
    it('changes and reads the current locale', () => {
      expect(getLocale()).toBe('en');
      setLocale('fr');
      expect(getLocale()).toBe('fr');
    });

    it('affects subsequent t() calls', () => {
      setLocale('fr');
      expect(t('greeting')).toBe('Bonjour');
    });
  });

  describe('loadLocale()', () => {
    it('loads translations for a new locale', () => {
      loadLocale('de', { greeting: 'Hallo' });
      setLocale('de');
      expect(t('greeting')).toBe('Hallo');
    });

    it('merges with existing translations for the same locale', () => {
      loadLocale('en', { new_key: 'New Value' });
      // existing keys still work
      expect(t('greeting')).toBe('Hello');
      // new key works too
      expect(t('new_key')).toBe('New Value');
    });
  });

  describe('resolveLocale()', () => {
    it('prefers tenant locale over other sources', () => {
      const result = resolveLocale({
        tenantLocale: 'fr-CA',
        acceptLanguage: 'en-US,en;q=0.9',
        telegramLanguageCode: 'en',
      });
      expect(result).toBe('fr-CA');
    });

    it('uses acceptLanguage when tenant locale is absent', () => {
      const result = resolveLocale({
        acceptLanguage: 'fr-CA,fr;q=0.9,en;q=0.8',
      });
      expect(result).toBe('fr-CA');
    });

    it('uses telegram language code as third priority', () => {
      const result = resolveLocale({
        telegramLanguageCode: 'fr',
      });
      expect(result).toBe('fr');
    });

    it('falls back to "en" when no source matches a loaded locale', () => {
      const result = resolveLocale({
        tenantLocale: 'zh-CN',
        acceptLanguage: 'zh-CN',
        telegramLanguageCode: 'zh',
      });
      expect(result).toBe('en');
    });

    it('falls back to "en" with empty sources', () => {
      expect(resolveLocale({})).toBe('en');
    });
  });
});
