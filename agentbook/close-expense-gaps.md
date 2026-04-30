# Close Expense Gaps — Implementation Plan

## Vision

As a user, I throw receipts (photos, PDFs) and credit card statements at the agent via Telegram. The agent reads them, records expenses, categorizes them, matches them against my bank feed, stores the receipts permanently, and proactively tells me about outliers, duplicates, overspending, and missing items. My expenses are fully under management without me opening a dashboard.

## 6 Gaps to Close

| # | Gap | Current State | Target State |
|---|-----|--------------|-------------|
| 1 | Telegram photo → OCR not wired | Photo creates $0.01 stub expense | Photo → Gemini Vision OCR → auto-record with real amount/vendor |
| 2 | Receipt images expire | Telegram temp URLs (24h) | Upload to Vercel Blob → permanent URL stored on expense |
| 3 | PDF receipt/statement parsing | Nothing | Telegram PDF → Gemini Vision → extract + record |
| 4 | Credit card statement import + matching | Only manual CSV | Upload CC CSV → parse → match against bank txns + expenses |
| 5 | Proactive handlers not wired to cron | 22 handler templates, no scheduler | Daily cron triggers handlers → sends alerts via Telegram |
| 6 | Expense review queue | All expenses auto-posted | Low-confidence items marked "pending_review" → user confirms via Telegram |

## Architecture

```
Telegram Photo/PDF
  → Webhook route (Next.js)
  → Upload image to Vercel Blob (permanent URL)
  → Call /receipts/ocr with blob URL
  → Gemini Vision extracts amount, vendor, date
  → If confidence > 0.7: auto-record expense + create journal entry
  → If confidence <= 0.7: mark as pending_review, ask user via Telegram
  → Bank sync matches expense to bank transaction
  → Proactive cron detects outliers → sends Telegram alerts
```

---

## Gap 1: Wire Telegram Photo → Real OCR

**Problem**: The Telegram webhook handler creates a stub expense with `amount_cents: 0` instead of calling the existing `/receipts/ocr` endpoint that has working Gemini Vision integration.

**Files to modify**:
- `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts`

**Changes**:
1. After getting the Telegram file URL, upload the image to Vercel Blob for permanent storage
2. Call `POST /api/v1/agentbook-expense/receipts/ocr` with the blob URL
3. Use the OCR result (amount, vendor, date, confidence) instead of the hardcoded stub
4. If OCR auto-created the expense (confidence > 0.7), reply with the details
5. If low confidence, reply asking user to confirm/edit

**E2E test**:
- POST to `/receipts/ocr` with a real image URL → verify amount_cents > 0, vendor extracted
- Verify expense is auto-created when confidence > 0.7
- Verify expense is NOT auto-created when confidence <= 0.7

---

## Gap 2: Permanent Receipt Storage via Vercel Blob

**Problem**: Receipt URLs point to Telegram's temporary file server (expires in ~24h). `@vercel/blob` is already installed and configured in `apps/web-next` with a working upload route at `/api/v1/storage/upload`.

**Files to modify**:
- `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` — upload before OCR
- `plugins/agentbook-expense/frontend/src/pages/NewExpense.tsx` — add file upload to web form
- `plugins/agentbook-expense/backend/src/server.ts` — add `POST /receipts/upload-file` that accepts multipart

**Changes**:
1. In Telegram webhook: download the Telegram file → upload to Vercel Blob → use blob URL for OCR and expense record
2. Add a new backend endpoint `POST /api/v1/agentbook-expense/receipts/upload-blob` that accepts a file URL, downloads it, uploads to Vercel Blob, returns permanent URL
3. Update expense creation to store the blob URL, not the Telegram URL

**E2E test**:
- POST to `/receipts/upload-blob` with a URL → verify returns a blob URL (or local path in dev)
- Verify expense.receiptUrl is a permanent URL, not a Telegram temp URL

---

## Gap 3: PDF Receipt Parsing via Gemini Vision

**Problem**: Telegram document handler says "coming soon". Gemini Vision can process PDFs.

**Files to modify**:
- `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` — handle document messages
- `plugins/agentbook-expense/backend/src/server.ts` — enhance `/receipts/ocr` to handle PDF URLs

**Changes**:
1. In Telegram webhook: when a PDF document is received, upload to Vercel Blob, then call `/receipts/ocr`
2. The OCR endpoint already works with Gemini Vision — just need to ensure the prompt handles PDF content
3. For multi-page PDFs (credit card statements), add a `/receipts/ocr-statement` endpoint that extracts multiple transactions

**E2E test**:
- POST to `/receipts/ocr` with a PDF URL → verify extracts data
- Verify PDF document via Telegram creates expense(s)

---

## Gap 4: Credit Card Statement Import + Matching

**Problem**: Users want to upload a credit card CSV/PDF and have the system match transactions against recorded expenses and bank feed.

**Files to modify**:
- `plugins/agentbook-expense/backend/src/server.ts` — add `POST /import/cc-statement` endpoint

**Changes**:
1. New endpoint `POST /api/v1/agentbook-expense/import/cc-statement` accepts `{ csv: string }` or `{ transactions: [{date, amount, description}] }`
2. For each CC transaction:
   - Check if it matches an existing expense (amount ±5%, date ±2 days, vendor fuzzy match)
   - Check if it matches a bank transaction
   - If matched: link them, mark as reconciled
   - If unmatched: create new expense with source="cc_statement", mark as pending_review
3. Return summary: matched, new, duplicates

**E2E test**:
- POST CC statement CSV → verify matched count > 0 for known expenses
- Verify unmatched CC transactions create new expenses
- Verify duplicates are detected and not double-counted

---

## Gap 5: Wire Proactive Handlers to Cron

**Problem**: 22 proactive handler templates exist in `packages/agentbook-framework/src/proactive-handlers/` but the cron jobs don't trigger them. The handlers return `ProactiveMessage` objects that are never delivered.

**Files to modify**:
- `apps/web-next/src/app/api/v1/agentbook/cron/daily-pulse/route.ts` — add proactive handler execution
- `plugins/agentbook-expense/backend/src/server.ts` — add `GET /advisor/proactive-alerts` endpoint that runs all expense-related handlers

**Changes**:
1. New endpoint `GET /api/v1/agentbook-expense/advisor/proactive-alerts` that runs these checks:
   - Missing receipts (business expenses >$25 without receipt)
   - Spending spike (category >20% vs last period)
   - Duplicate expenses (same vendor + amount within 3 days)
   - Unmatched bank transactions (>7 days old, still pending)
   - Subscription changes (new recurring charge or amount change)
   - Over-budget categories (if budget set)
2. Returns `ProactiveAlert[]` with severity, message, and suggested action
3. Daily cron calls this endpoint for each tenant and logs alerts as events
4. Telegram integration: alerts can be sent as messages (using existing bot infrastructure)

**E2E test**:
- GET `/advisor/proactive-alerts` for Maya → verify at least 1 alert returned
- Verify alerts have required fields: type, severity, title, message
- Verify alerts are different from insights (proactive-alerts are actionable notifications)

---

## Gap 6: Expense Review Queue

**Problem**: All expenses are auto-posted to the ledger immediately, even low-confidence OCR results. Users should review uncertain items before they hit the books.

**Files to modify**:
- `packages/database/prisma/schema.prisma` — add `status` field to AbExpense
- `plugins/agentbook-expense/backend/src/server.ts` — add review endpoints
- `plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx` — add review filter tab

**Changes**:
1. Add `status` field to AbExpense: `confirmed | pending_review | rejected` (default: `confirmed`)
2. When OCR confidence <= 0.7: create expense with `status: 'pending_review'`, skip journal entry
3. New endpoints:
   - `GET /api/v1/agentbook-expense/review-queue` — list pending_review expenses
   - `POST /api/v1/agentbook-expense/expenses/:id/confirm` — confirm expense → create journal entry, set status=confirmed
   - `POST /api/v1/agentbook-expense/expenses/:id/reject` — reject expense → set status=rejected
4. In Telegram: low-confidence items show confirm/edit/reject buttons
5. In web UI: add "Needs Review" tab showing pending items with one-click confirm

**E2E test**:
- Create expense with confidence=0.5 → verify status is pending_review
- POST confirm → verify status changes to confirmed and journal entry is created
- POST reject → verify status changes to rejected
- GET review-queue → verify only pending_review items returned
- Verify high-confidence expenses (>0.7) auto-confirm

---

## Implementation Order

| Order | Gap | Depends On | Effort |
|-------|-----|-----------|--------|
| 1 | Gap 6: Review queue (schema change) | — | 30 min |
| 2 | Gap 2: Vercel Blob receipt storage | — | 30 min |
| 3 | Gap 1: Wire Telegram photo → OCR | Gap 2, Gap 6 | 30 min |
| 4 | Gap 3: PDF receipt parsing | Gap 2, Gap 1 | 30 min |
| 5 | Gap 4: CC statement import + matching | Gap 6 | 45 min |
| 6 | Gap 5: Proactive alerts wired to cron | — | 30 min |

**Total: ~3 hours**

## E2E Test File

All tests go in `tests/e2e/expense-gaps.spec.ts`. Tests cover:
- OCR endpoint with Gemini Vision
- Receipt blob storage (permanent URL)
- PDF parsing
- CC statement import + matching
- Proactive alerts generation
- Review queue (pending → confirm/reject)
- Expense status lifecycle
- Auto-journal-entry on confirm
