import { loadLocale } from './core.js';

// English
import enCommon from './locales/en/common.json' assert { type: 'json' };
import enExpense from './locales/en/expense.json' assert { type: 'json' };
import enInvoice from './locales/en/invoice.json' assert { type: 'json' };
import enTax from './locales/en/tax.json' assert { type: 'json' };
import enProactive from './locales/en/proactive.json' assert { type: 'json' };
import enCalendar from './locales/en/calendar.json' assert { type: 'json' };

// French
import frCommon from './locales/fr/common.json' assert { type: 'json' };
import frExpense from './locales/fr/expense.json' assert { type: 'json' };
import frInvoice from './locales/fr/invoice.json' assert { type: 'json' };
import frTax from './locales/fr/tax.json' assert { type: 'json' };
import frProactive from './locales/fr/proactive.json' assert { type: 'json' };
import frCalendar from './locales/fr/calendar.json' assert { type: 'json' };

export function loadAllLocales(): void {
  // English
  loadLocale('en', { common: enCommon, expense: enExpense, invoice: enInvoice, tax: enTax, proactive: enProactive, calendar: enCalendar });

  // French (Canadian)
  loadLocale('fr', { common: frCommon, expense: frExpense, invoice: frInvoice, tax: frTax, proactive: frProactive, calendar: frCalendar });
}
