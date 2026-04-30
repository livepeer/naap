# AgentBook Product Reference

## What It Is

AI-powered accounting for freelancers and small businesses. Unlike QuickBooks (ledger with forms), AgentBook is a **financial agent** that figures out what happened, what it means, and what to do — before you ask.

## Target Users

| Persona | Profile | Key Need |
|---------|---------|----------|
| **Maya** | IT consultant, Toronto, $180K CAD, 3 clients | Zero-effort bookkeeping, Canadian tax (T2125, GST/HST) |
| **Alex** | Design agency, Austin TX, $300K USD, 5 clients, 2 contractors | Project profitability, 1099 tracking, multi-client billing |
| **Jordan** | Side-hustle (Etsy + writing), Portland, $35K USD | Business/personal separation, Schedule C alongside W-2 |

Test accounts: see `agentbook/users.md`

## Core Differentiators (vs QuickBooks/Wave)

1. **Telegram-first** — send receipt photos, type expenses, get proactive alerts. No app to install.
2. **AI auto-categorization** — learns vendor patterns, 95%+ accuracy after 30 days
3. **Gemini-powered OCR** — receipt photos/PDFs → auto-extract amount, vendor, date
4. **Proactive money moves** — agent warns about cash cushion, tax bombs, spending spikes, revenue cliffs
5. **Conversational Q&A** — "How much on travel last quarter?" → instant answer with chart
6. **What-if simulator** — "What if I hire someone at $5K/mo?" → 12-month projection
7. **4 autonomous agents** — Bookkeeper, Tax Strategist, Collections, Insights — each with personality
8. **Multi-jurisdiction** — US, CA, UK, AU tax rules built in

## Competitive Score

Phase 11 analysis (100-feature comparison):

| Category | Score | Max |
|----------|-------|-----|
| Expense Management | 46 | 50 (92%) |
| Invoicing & Payments | 42 | 50 (84%) |
| Tax & Compliance | 27 | 30 (90%) |
| Reporting | 46 | 50 (92%) |
| Platform & UX | 42 | 50 (84%) |
| **Total** | **203** | **230 (88%)** |

## Feature Inventory

### Expense Workflow (the hero flow)
- Telegram photo → Vercel Blob → Gemini Vision OCR → auto-record expense
- Telegram PDF → same flow
- Text: "Spent $45 on lunch at Starbucks" → parsed, recorded, categorized
- CSV/CC statement import with auto-matching
- Bank sync via Plaid (sandbox live) with auto-reconciliation
- AI Advisor: insights (spending spikes, duplicates, savings), smart charts (bar/pie/trend), natural language Q&A
- Review queue: low-confidence items go to pending_review, confirm/reject via Telegram buttons
- Split transactions (business/personal)
- Auto-tagging by vendor patterns (18 tag categories)
- Proactive alerts: missing receipts, unmatched bank txns, spending spikes, uncategorized items

### Invoicing
- Create from natural language or form
- Professional PDF generation with multi-currency (USD/CAD/GBP/EUR/AUD)
- Email delivery (Resend provider, log fallback in dev)
- Recurring invoices (weekly → annual, auto-generate via cron)
- Payment reminders (gentle → firm → urgent tone escalation)
- Credit notes with reversing journal entries
- Estimates with convert-to-invoice
- Time tracking with project profitability

### Tax & Compliance
- Real-time tax estimate (US + CA brackets, SE tax, effective rate)
- Quarterly installment tracking with deadline alerts
- Deduction hunting (5-category gap analysis)
- T2125/Schedule C tax package generation (HTML)
- GST/HST/sales tax tracking
- 1099/T4A contractor threshold monitoring

### AI Features (Phase 12)
- Conversational financial memory with conversation history
- Autonomous workflow composition (natural language → automation rules)
- Financial digital twin (what-if scenarios with 12-month projections)
- Personalized CFO personality (adapts communication style per user)

## Key Workflows (User Journey)

### New User Onboarding
Login → 7-step wizard (jurisdiction, currency, fiscal year) → seed chart of accounts → connect Telegram → snap first receipt

### Daily Expense Flow
1. User snaps receipt in Telegram
2. Photo uploaded to Vercel Blob (permanent storage)
3. Gemini Vision extracts amount, vendor, date
4. If confidence > 0.7: auto-record + confirm buttons
5. If confidence <= 0.7: pending_review + confirm/edit/reject buttons
6. Auto-categorized by vendor pattern
7. Journal entry created (debit expense, credit cash)
8. Shows up in web dashboard + AI advisor insights

### Bank Reconciliation Flow
1. Connect bank via Plaid Link (sandbox: user_good/pass_good)
2. Sync imports last 30 days of transactions
3. Auto-match: amount ±5% + date ±2 days → matched
4. Unmatched items flagged as pending
5. Proactive alert after 7 days unmatched

### Tax Season Flow
1. Tax Strategist agent monitors all year
2. Quarterly reminders 7 days before deadline
3. Deduction suggestions proactively surfaced
4. Year-end: generate complete tax package (T2125 or Schedule C)
5. CPA portal for accountant review
