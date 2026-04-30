# Adding a New Language

1. Copy this directory and rename to your language code (e.g., `es/` for Spanish)
2. Create these JSON files, translating from the `en/` versions:
   - common.json
   - expense.json
   - invoice.json
   - tax.json
   - proactive.json
   - calendar.json
3. The i18n runtime discovers new locales automatically — no code changes needed.
4. Test: set a tenant's locale to your new language and verify all strings render.
