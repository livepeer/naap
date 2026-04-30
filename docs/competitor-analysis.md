# AgentBook Competitor Analysis

## Competitors Evaluated

| Product | Target | Pricing | Approach |
|---------|--------|---------|----------|
| **QuickBooks Solopreneur** | Freelancers, 1-person biz | $20/mo | Traditional web/mobile app |
| **Wave Accounting** | Freelancers, micro-biz | Free (starter), $16/mo (pro) | Web app, free tier |
| **FreshBooks** | Service businesses, freelancers | $21-65/mo | Web/mobile, invoice-first |
| **AgentBook** | Freelancers, consultants | TBD | AI-first, Telegram-native |

---

## Feature Comparison Matrix

### Bookkeeping

| Feature | QuickBooks | Wave | FreshBooks | AgentBook | Gap? |
|---------|-----------|------|-----------|-----------|------|
| Record expenses | Yes | Yes | Yes | Yes (voice/text) | No |
| Receipt OCR (photo) | Yes (mobile) | Yes (free) | Yes | Yes (Telegram) | No |
| Auto-categorization | Yes (AI) | Basic rules | Yes (AI) | Yes (keywords + learning) | No |
| Bank connection (Plaid) | Yes | Yes (Pro) | Yes | Yes (Plaid sandbox) | No |
| Bank reconciliation | Yes | Yes (Pro) | Yes | Yes | No |
| Recurring expense tracking | Yes | No | Yes | Yes | No |
| Mileage/vehicle tracking | Yes (mobile GPS) | No | Yes (GPS) | Partial (manual km entry) | **Minor** — no GPS |
| Multi-currency | Yes | Yes | Yes | Partial (CAD/USD stored, no conversion) | **Minor** |
| Expense reports (PDF) | Yes | Yes | Yes | No | **Medium** |
| Inventory tracking | Yes | No | No | No | No (not target market) |
| Bulk CSV import | Yes | Yes | Yes | API exists, not in agent | **Minor** |

### Invoicing

| Feature | QuickBooks | Wave | FreshBooks | AgentBook | Gap? |
|---------|-----------|------|-----------|-----------|------|
| Create invoices | Yes | Yes | Yes | Yes (conversational) | No |
| Multi-line invoices | Yes | Yes | Yes | Single-line only | **Medium** |
| Customizable templates | Yes | Yes | Yes | Basic HTML | **Medium** |
| Recurring invoices | Yes | Yes | Yes | Yes | No |
| Estimates/quotes | Yes | Yes | Yes | Yes | No |
| Estimate → invoice | Yes | Yes | Yes | Yes | No |
| Send via email | Yes | Yes | Yes | Yes (Resend API) | No |
| Payment reminders | Yes | Yes (auto) | Yes (auto) | Yes (manual trigger) | **Minor** — no auto-send |
| Online payments (Stripe) | Yes | Yes (2.9%) | Yes (2.9%) | Webhook only, no pay link | **Major** |
| Client portal | Yes | No | Yes | No | **Medium** |
| Credit notes | Yes | No | Yes | Yes | No |
| Void invoices | Yes | Yes | Yes | Yes | No |
| Time tracking | Yes | No | Yes | Yes | No |
| Project management | Basic | No | Yes | Basic (projects model) | **Minor** |
| Proposal/contracts | No | No | Yes | No | **Low** — niche |

### Tax

| Feature | QuickBooks | Wave | FreshBooks | AgentBook | Gap? |
|---------|-----------|------|-----------|-----------|------|
| Tax estimates | Yes (SE) | No | No | Yes | Advantage |
| Quarterly payment tracking | Yes | No | No | Yes | Advantage |
| Deduction suggestions | Yes | No | No | Yes | Advantage |
| Tax form prep (T1/T2125) | No (via TurboTax) | No | No | Yes (Phase A) | **Advantage** |
| Tax slip OCR (T4/T5) | No | No | No | Yes | **Advantage** |
| Form export (PDF/XML) | Via TurboTax | No | No | Yes (Phase B) | **Advantage** |
| E-filing | Via TurboTax ($) | No | No | Yes (Phase C, mock) | **Advantage** |
| GST/HST return | Yes | Yes (basic) | Yes | Yes | No |
| Sales tax tracking | Yes | Yes | Yes | Yes (model exists) | No |
| TurboTax integration | Yes (direct) | No | No | No (own filing) | Different approach |

### Financial Reports & Planning

| Feature | QuickBooks | Wave | FreshBooks | AgentBook | Gap? |
|---------|-----------|------|-----------|-----------|------|
| P&L report | Yes | Yes | Yes | Yes | No |
| Balance sheet | Yes | Yes | Yes | Yes | No |
| Cash flow statement | Yes | Yes | Yes | Yes | No |
| Cash flow projection | No | No | No | Yes (30/60/90 day) | **Advantage** |
| What-if simulation | No | No | No | Yes | **Advantage** |
| AR aging report | Yes | Yes | Yes | Yes | No |
| Budget tracking | Yes | No | Basic | No | **Medium** |
| Proactive alerts | No | No | No | Yes | **Advantage** |
| Money moves/suggestions | No | No | No | Yes | **Advantage** |
| Dashboard | Yes | Yes | Yes | Yes (web + Telegram) | No |

### Platform & UX

| Feature | QuickBooks | Wave | FreshBooks | AgentBook | Gap? |
|---------|-----------|------|-----------|-----------|------|
| Web app | Yes | Yes | Yes | Yes | No |
| Mobile app (iOS/Android) | Yes | Yes (iOS) | Yes | No native app | **Medium** |
| Telegram bot | No | No | No | Yes | **Advantage** |
| Conversational AI | Basic (Intuit Assist) | No | No | Full (56 skills) | **Advantage** |
| Multi-step planning | No | No | No | Yes (plan → execute → evaluate) | **Advantage** |
| Learning from corrections | No | No | No | Yes (confidence-based) | **Advantage** |
| CPA collaboration | Yes (accountant access) | Yes (accountant access) | Yes | Yes (notes + share link) | No |
| User onboarding | Yes | Yes | Yes | Yes | No |
| Automation rules | Yes (limited) | No | Yes (workflows) | Yes (NL-based) | No |
| API access | Yes ($) | Yes (limited) | Yes | Yes (open) | No |
| Multi-user/team | Yes | Yes | Yes | No | **Medium** — single user |
| Payroll | Yes ($) | Yes (CA/US) | No | No | **Low** — different market |

---

## Gap Prioritization

### Critical Gaps (must have for market viability)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| **Online payment links** (Stripe checkout in invoices) | High — clients can't pay online | Medium | P1 |
| **Multi-line invoices** via agent | Medium — limits complex invoices | Low | P1 |
| **Mobile app or PWA** | High — competitors all have mobile | High | P2 |

### Important Gaps (competitive disadvantage without them)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| **Budget tracking** | Medium — popular feature | Medium | P2 |
| **Expense reports (PDF export)** | Medium — needed for clients/employers | Low | P2 |
| **Client portal** (view invoice, pay online) | Medium — professional appearance | Medium | P3 |
| **Auto payment reminders** (scheduled, not manual) | Low — convenience | Low | P2 |
| **Invoice templates** (customizable branding) | Medium — brand perception | Medium | P3 |
| **Multi-user support** | Medium — agencies, small teams | High | P3 |

### Minor Gaps (nice to have)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Mileage GPS tracking | Low | Medium (needs mobile) | P4 |
| Multi-currency conversion | Low | Low | P3 |
| Bulk CSV import via agent | Low | Low | P4 |
| Project profitability reports | Low | Low | P3 |

### Not Needed (wrong market)

| Feature | Why Skip |
|---------|----------|
| Inventory tracking | Target is service businesses, not retail |
| Payroll | Different product category |
| Native mobile app | Telegram IS the mobile experience |
| Proposals/contracts | Niche, low demand |

---

## AgentBook Unique Advantages (Moat)

These features don't exist in ANY competitor:

| Advantage | Description | Defensibility |
|-----------|-------------|--------------|
| **Conversational AI (56 skills)** | Full accounting via natural language in Telegram | High — deep integration |
| **Multi-step planning** | Agent creates plans, user confirms, agent executes with evaluation | High — unique UX |
| **Confidence-based learning** | Agent learns vendor→category patterns, adapts to user corrections | High — personalization |
| **Tax filing prep (Canada)** | Guided T1/T2125/GST filing with OCR slip scanning | High — no competitor does this |
| **Cash flow projection** | 30/60/90 day forecasting from actual data | Medium |
| **What-if simulation** | "What if I hire at $5K/mo?" financial modeling | Medium |
| **Proactive money moves** | AI suggests actions based on financial data | Medium |
| **Receipt + Tax slip OCR** | Gemini Vision extracts from any photo quality | Medium |

---

## Strategic Recommendations

### Phase 1: Close Critical Gaps (next sprint)
1. **Stripe payment links in invoices** — add `paymentUrl` to invoice, generate Stripe Checkout session
2. **Multi-line invoice support** — parse "Invoice Acme: consulting $3000, design $2000, hosting $500"
3. **Auto payment reminders** — cron/scheduled skill that runs daily

### Phase 2: Differentiate Further
4. **Budget tracking** — set monthly category budgets, alert when exceeded
5. **Expense report PDF** — generate formatted PDF for a date range
6. **PWA support** — make web app installable on mobile (no app store needed)

### Phase 3: Enterprise Features
7. **Client portal** — shareable invoice link where clients can view + pay
8. **Multi-user** — invite team members with role-based access
9. **Custom invoice templates** — drag-and-drop or HTML template editor

### Don't Build
- Native mobile app (Telegram + PWA covers mobile)
- Inventory management (wrong market)
- Payroll (separate product)
- Complex project management (stay focused)

---

## Bottom Line

AgentBook's **conversational AI approach is genuinely unique** — no competitor offers full accounting via chat. The tax filing prep capability is a significant differentiator especially for Canadian freelancers.

The main competitive risks are:
1. **No online payment acceptance** — this is table stakes for invoicing software
2. **No mobile app** — mitigated by Telegram but some users expect a native app
3. **Single-user only** — limits growth into small teams

The AI-first approach means AgentBook can deliver features faster (add a skill manifest vs build a UI) and provide a fundamentally different user experience. The key is ensuring the core workflows (bookkeeping, invoicing, tax) work reliably end-to-end before optimizing the gaps.
