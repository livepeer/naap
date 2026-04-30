# Close P2-P3 Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all remaining competitive gaps from the competitor analysis — budget tracking, expense report PDF, invoice templates, client portal page, multi-currency display.

**Architecture:** All skill-driven. New skills for agent brain, endpoints for plugins, UI pages where needed. Each feature works via Telegram bot AND web.

**Gaps to Close:**

| # | Gap | Priority | Agent Skill | UI Component |
|---|-----|----------|-------------|--------------|
| 1 | Budget tracking (set/query) | P2 | `set-budget`, `query-budget` | Budget card on dashboard |
| 2 | Expense report PDF | P2 | `expense-report` | Download button |
| 3 | Invoice template branding | P3 | N/A (config) | Settings field |
| 4 | Client portal (view + pay) | P3 | N/A (public page) | Public invoice page |
| 5 | Multi-currency display | P3 | N/A (formatting) | Currency symbol in all outputs |

---

## Task 1: Budget Tracking

**Files:**
- Modify: `packages/database/prisma/schema.prisma` — add AbBudget model
- Modify: `plugins/agentbook-expense/backend/src/server.ts` — 3 endpoints
- Modify: `plugins/agentbook-core/backend/src/server.ts` — 2 skills
- Modify: `plugins/agentbook-core/backend/src/agent-evaluator.ts` — budget quality check

### Schema
```prisma
model AbBudget {
  id            String   @id @default(uuid())
  tenantId      String
  categoryId    String?                          // null = total budget
  categoryName  String?                          // denormalized for display
  amountCents   Int
  period        String   @default("monthly")     // monthly | quarterly | annual
  alertPercent  Int      @default(80)            // alert at 80% spent
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([tenantId, categoryId, period])
  @@index([tenantId])
  @@schema("plugin_agentbook_expense")
}
```

### Expense Plugin Endpoints
```
POST /api/v1/agentbook-expense/budgets — Create/update budget
GET  /api/v1/agentbook-expense/budgets — List budgets with spending vs budget
GET  /api/v1/agentbook-expense/budgets/status — Budget health (over/under/on track per category)
```

### Agent Skills
```typescript
{
  name: 'set-budget', description: 'Set a monthly budget — total or per category', category: 'bookkeeping',
  triggerPatterns: ['set.*budget', 'budget.*\\$', 'monthly.*budget', 'spending.*limit'],
  parameters: { amountCents: { type: 'number', required: true }, category: { type: 'string', required: false }, period: { type: 'string', required: false, default: 'monthly' } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/budgets' },
},
{
  name: 'query-budget', description: 'Check budget status — spending vs budget by category', category: 'bookkeeping',
  triggerPatterns: ['budget.*status', 'over.*budget', 'under.*budget', 'how.*budget', 'spending.*vs.*budget'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/budgets/status' },
},
```

### Response Formatting
```typescript
// Budget status
} else if (data?.budgets && Array.isArray(data.budgets)) {
  message = '**Budget Status**\n';
  for (const b of data.budgets) {
    const pct = Math.round((b.spentCents / b.amountCents) * 100);
    const icon = pct > 100 ? '\u{1F534}' : pct > b.alertPercent ? '\u{1F7E1}' : '\u{1F7E2}';
    message += `\n${icon} **${b.categoryName || 'Total'}**: $${(b.spentCents / 100).toFixed(0)} / $${(b.amountCents / 100).toFixed(0)} (${pct}%)`;
  }
```

---

## Task 2: Expense Report PDF

**Files:**
- Modify: `plugins/agentbook-expense/backend/src/server.ts` — 1 endpoint
- Modify: `plugins/agentbook-core/backend/src/server.ts` — 1 skill

### Endpoint
```
POST /api/v1/agentbook-expense/reports/expense-pdf — Generate expense report HTML
Body: { startDate, endDate, format?: 'html' }
Returns: Styled HTML with expense table, category totals, charts
```

### Agent Skill
```typescript
{
  name: 'expense-report', description: 'Generate an expense report PDF for a date range', category: 'bookkeeping',
  triggerPatterns: ['expense.*report', 'generate.*report', 'expense.*pdf', 'print.*expense'],
  parameters: { startDate: { type: 'string', required: false }, endDate: { type: 'string', required: false } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/reports/expense-pdf' },
},
```

---

## Task 3: Invoice Template Branding

**Files:**
- Modify: `packages/database/prisma/schema.prisma` — add branding fields to AbTenantConfig
- Modify: `plugins/agentbook-invoice/backend/src/server.ts` — use branding in generateInvoiceHtml
- Modify: `plugins/agentbook-core/frontend/src/pages/TelegramSettings.tsx` — add branding section (or create BrandingSettings page)

### Schema additions to AbTenantConfig
```prisma
  companyName     String?
  companyAddress  String?
  companyEmail    String?
  companyPhone    String?
  logoUrl         String?
  brandColor      String   @default("#1a1a2e")
```

### Invoice HTML update
Use tenant config branding in `generateInvoiceHtml()` — company name, logo, colors.

---

## Task 4: Client Portal — Public Invoice Page

**Files:**
- Create: `apps/web-next/src/app/pay/[invoiceId]/page.tsx` — public invoice view
- Modify: `plugins/agentbook-invoice/backend/src/server.ts` — public endpoint GET /invoices/:id/public

### Public endpoint
```
GET /api/v1/agentbook-invoice/invoices/:id/public — No auth required
Returns: Invoice details (no tenant secrets), payment status, payment link
Marks invoice as "viewed" if currently "sent"
```

### Public page
Simple Next.js page showing:
- Invoice number, date, due date
- Line items table
- Total amount
- Payment status (paid/unpaid/overdue)
- "Pay Now" button (if payment link exists)
- "Download PDF" link

---

## Task 5: Multi-Currency Display

**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts` — currency-aware formatting

### Formatting helper
```typescript
function formatCurrency(cents: number, currency: string = 'USD'): string {
  const symbols: Record<string, string> = { USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$' };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
```

Apply to all response formatters that currently use `$${(...).toFixed(2)}`.

---

## Task 6: Comprehensive E2E Tests

**Files:**
- Create: `tests/e2e/agent-gaps.spec.ts` — tests for all P2-P3 features

### Tests
```typescript
test.describe.serial('P2-P3 Gap Closure', () => {
  // Budget
  test('set-budget: "set monthly budget $5000"', ...);
  test('query-budget: "how is my budget?"', ...);

  // Expense report
  test('expense-report: "generate expense report"', ...);

  // Payment link
  test('create-payment-link: "generate payment link"', ...);

  // Auto reminders
  test('toggle-auto-reminders: "enable auto reminders"', ...);

  // Multi-line invoice
  test('multi-line: "invoice Acme: consulting $3000, design $2000"', ...);

  // All skills wired
  test('total skills count', ...);
});
```

---

## Task 7: Skill Count Update + Full Suite

Update agent-brain.spec.ts skill count, run ALL test files, fix failures, push.
