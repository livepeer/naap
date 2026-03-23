/**
 * i18n runtime for AgentBook.
 * Every user-facing string uses t() with interpolation.
 * No hardcoded strings in business logic or UI.
 */

type TranslationData = Record<string, string | Record<string, string>>;

const locales: Map<string, TranslationData> = new Map();
let currentLocale = 'en';
let fallbackLocale = 'en';

/** Load a locale's translations. */
export function loadLocale(locale: string, data: TranslationData): void {
  locales.set(locale, { ...locales.get(locale), ...data });
}

/** Set the active locale. */
export function setLocale(locale: string): void {
  currentLocale = locale;
}

/** Get the active locale. */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Translate a key with optional interpolation.
 * Supports nested keys: t('expense.receipt_saved', { amount: '$45.00' })
 * Falls back to fallback locale, then returns the key itself.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const translation = resolveKey(key, currentLocale) || resolveKey(key, fallbackLocale) || key;

  if (!params) return translation;

  return translation.replace(/\{(\w+)\}/g, (match, paramName) => {
    return params[paramName] !== undefined ? String(params[paramName]) : match;
  });
}

function resolveKey(key: string, locale: string): string | undefined {
  const data = locales.get(locale);
  if (!data) return undefined;

  // Support dot-notation: 'expense.receipt_saved'
  const parts = key.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Resolve locale from multiple sources.
 * Priority: tenant config > browser header > Telegram language_code > default
 */
export function resolveLocale(sources: {
  tenantLocale?: string;
  acceptLanguage?: string;
  telegramLanguageCode?: string;
}): string {
  if (sources.tenantLocale && locales.has(sources.tenantLocale.split('-')[0])) {
    return sources.tenantLocale;
  }
  if (sources.acceptLanguage) {
    const primary = sources.acceptLanguage.split(',')[0].split(';')[0].trim();
    const lang = primary.split('-')[0];
    if (locales.has(lang)) return primary;
  }
  if (sources.telegramLanguageCode && locales.has(sources.telegramLanguageCode)) {
    return sources.telegramLanguageCode;
  }
  return 'en';
}
