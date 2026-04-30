# AgentBooks — MVP requirements (v2)

> Revised after competitive analysis of Wave Accounting (free/$19 Pro) and QuickBooks Solopreneur ($20/mo). This version closes every feature gap with both products and adds agent-native capabilities neither can match.

---

## Product vision

AgentBooks is an agent-based accounting system built on NaaP that acts as a full-time bookkeeper, tax planner, and cash flow manager for self-employed individuals and small business owners. The primary interface is a Telegram bot; a web dashboard and mobile app provide visualization and on-the-go access. The user expresses intent in natural language; the agent executes with guardrails, memory, and human-in-the-loop escalation.

### Competitive positioning

| Capability | Wave (free/$19) | QB Solopreneur ($20) | AgentBooks |
|-----------|----------------|---------------------|------------|
| Interface | Web app, mobile app | Web app, mobile app | Telegram bot + web + mobile |
| Input method | Manual forms, bank import | Manual forms, bank import | Natural language, photo, voice note |
| Proactive guidance | None | Basic tips | Agent suggests deductions, warns about cash flow, optimizes tax timing |
| Tax preparation | None (H&R Block referral) | TurboTax integration | Built-in Schedule C generation, quarterly estimates, deduction optimization |
| Automation level | Auto-categorize bank transactions | Auto-categorize, auto-mileage | Agent plans and executes multi-step workflows autonomously |
| Learning | Rule-based matching | Basic pattern matching | Pattern memory that improves with every interaction |
| Human-in-the-loop | None | None | Configurable escalation for high-stakes actions |
| Onboarding time | 30-60 minutes | 30-60 minutes | < 5 minutes via Telegram conversation |
| Price target | Free core / $19 Pro | $20/month | Free core / $12 Pro (undercut both) |

### Why AgentBooks wins

Wave and QuickBooks both require the user to learn a UI, navigate menus, and manually initiate every action. AgentBooks inverts this: the agent comes to you (via Telegram), understands your intent in natural language, and does the work. Wave has no tax features. QuickBooks has basic tax estimation but no proactive optimization. AgentBooks actively hunts for deductions you're missing and suggests timing strategies to minimize your liability. Neither competitor learns from your patterns to get faster and more accurate over time.

---

## Personas

**Primary: Solo freelancer ("Maya")**
Self-employed consultant or freelancer. 1-5 clients. Invoices monthly. Mixes personal and business expenses on the same card. Dreads tax season. Uses Telegram daily. Needs: expense tracking, invoice management, tax estimation, cash flow visibility, personal/business separation.

**Secondary: Micro-business owner ("Raj")**
Small agency or studio, 2-10 contractors. Manages payables and receivables. Needs categorized expense reports, quarterly tax planning, contractor 1099 management, sales tax tracking, and payment collection via multiple methods.

**Tertiary: The CPA ("Linda")**
Maya or Raj's accountant. Needs read-only access to books, ability to leave notes, downloadable reports and tax packages, and confidence that the underlying data is GAAP-compliant double-entry.

---

## Epic 1: Expense collection and categorization

### US-1.1: Capture expense via Telegram
**As** Maya, **I want to** snap a photo of a receipt, type a description, forward an email receipt, or send a voice note to the Telegram bot, **so that** the agent records the expense without me opening any app.

Acceptance criteria:
- Agent accepts: photo of receipt (OCR), typed text ("$45 lunch with client"), forwarded email receipt, PDF attachment, voice note (speech-to-text then parse)
- Agent extracts: amount, vendor, date, currency, tax/tip breakdown, individual line items when visible
- Agent auto-categorizes using IRS Schedule C categories plus user-defined custom categories
- Agent confirms with inline keyboard: [Correct] [Change category] [Edit amount] [Split items] [Mark personal]
- If confidence < 80%, agent asks user to confirm before recording
- Foreign currency auto-converted at transaction-date exchange rate, with both original and base amounts stored
- Receipt image stored and linked to transaction for audit trail

### US-1.2: Business vs personal expense separation
**As** Maya, **I want** to mark expenses as personal or business, **so that** only business expenses appear in my tax reports and I can use one bank account for everything.

Acceptance criteria:
- Every expense defaults to "business" unless the user or agent marks it personal
- Agent learns personal patterns: "Netflix is always personal for you — marked accordingly"
- Personal expenses are tracked separately but excluded from P&L, Schedule C, and tax estimates
- Bank feed transactions can be bulk-marked: "Mark all transactions from Whole Foods as personal"
- Split transactions supported: "$200 at Costco — $150 business supplies, $50 personal groceries"
- Dashboard shows business-only and combined views

### US-1.3: Recurring expense detection and auto-recording
**As** Maya, **I want** the agent to recognize recurring expenses and record them automatically, **so that** I don't have to enter them every month.

Acceptance criteria:
- After 3 similar expenses (same vendor, similar amount, regular interval), agent proposes automation
- User can approve, modify frequency/amount, or decline
- Auto-recorded expenses include a 1-hour undo window with Telegram notification
- Recurring rules are editable: "Change my Figma subscription from $49.99 to $59.99 starting next month"
- If a recurring expense doesn't appear as expected (e.g., subscription cancelled), agent asks: "I expected a $49.99 Figma charge today but didn't see it. Did you cancel?"

### US-1.4: Custom expense categories
**As** Maya, **I want to** customize my expense categories, **so that** they match my business type and tax situation.

Acceptance criteria:
- Default categories aligned to IRS Schedule C lines: advertising, car/truck, commissions, contract labor, depreciation, insurance, interest (mortgage/other), legal/professional, office expense, rent/lease, repairs, supplies, taxes/licenses, travel, meals, utilities, wages, other
- User can add sub-categories: "Add 'coworking space' under rent/lease"
- User can add entirely new categories and map them to Schedule C lines
- Agent remembers per-vendor category preferences
- Category merging and renaming supported
- Categories exportable in a format a CPA can understand

### US-1.5: GPS mileage tracking
**As** Maya, **I want** automatic mileage tracking when I'm driving for business, **so that** I can claim the standard mileage deduction without manually logging trips.

Acceptance criteria:
- Mobile app tracks trips via GPS automatically (opt-in, battery-conscious)
- Each trip can be classified: business or personal (swipe UI or Telegram command)
- Manual trip entry via Telegram: "Drove 23 miles to client meeting downtown"
- Agent calculates deduction at current IRS standard rate ($0.70/mile for 2025, updated annually)
- Supports both standard mileage rate and actual expense methods, with agent recommending the higher deduction
- Monthly and annual mileage summaries
- Trip log exportable as PDF for IRS audit documentation

### US-1.6: Receipt management and storage
**As** Maya, **I want** all my receipts stored and searchable, **so that** I can find them during an audit or tax preparation.

Acceptance criteria:
- Every receipt photo stored in cloud storage linked to the transaction
- OCR text is searchable: "Find receipts from Staples"
- Receipts organized by month and category
- Bulk receipt upload via web dashboard (drag and drop)
- 7-year retention (IRS requirement) with automatic archival policy
- Export all receipts as a ZIP file organized by category and year

---

## Epic 2: Invoicing and payment collection

### US-2.1: Create and send invoice via Telegram
**As** Maya, **I want to** tell the agent to invoice a client, **so that** I can bill without logging into any software.

Acceptance criteria:
- User says: "Invoice Acme Corp $5,000 for March consulting, net-30"
- Agent resolves client from memory or asks for details if new
- Agent generates professional PDF invoice with: auto-incrementing invoice number, business name/address/logo, client details, line items with descriptions, payment terms, due date, payment link, sales tax (if applicable), notes/memo field
- Customizable invoice templates (at least 3 professional designs)
- Agent sends invoice to client via email
- Preview before sending: "Show me the invoice first"
- Late payment interest/fee terms configurable per client

### US-2.2: Estimates and quotes
**As** Raj, **I want to** send estimates to potential clients, **so that** they can approve the scope before I invoice.

Acceptance criteria:
- Create estimate via Telegram: "Send an estimate to Acme for $8,000 website redesign"
- Estimate includes: line items, total, validity period, terms
- Client can approve or request changes via email link
- Approved estimates convert to invoices with one command: "Convert the Acme estimate to an invoice"
- Estimate tracking: pending, approved, declined, expired, converted

### US-2.3: Recurring invoices
**As** Maya, **I want to** set up recurring invoices for retainer clients, **so that** they go out automatically every month.

Acceptance criteria:
- User says: "Invoice Acme $3,000 every month on the 1st for ongoing consulting"
- Agent creates recurring rule and auto-generates invoices on schedule
- User notified before each recurring invoice sends: "About to send $3,000 invoice to Acme. [Send] [Skip this month] [Edit]"
- Recurring invoices auto-increment invoice numbers
- End date or "until I say stop" options

### US-2.4: Multi-method payment collection
**As** Maya, **I want** clients to pay via credit card, ACH, or other methods, **so that** I get paid faster.

Acceptance criteria:
- Stripe integration: credit card (Visa, Mastercard, Amex, Discover), ACH bank transfer
- Each invoice includes a hosted payment page link
- Payment method fees tracked and auto-categorized: "Stripe processing fee: $145.50 (payment processing expense)"
- When payment received, agent auto-records: payment date, amount, method, invoice reference, fees
- Agent notifies user: "Acme Corp paid #INV-2026-0024 ($5,000). Stripe fee: $145.50. Net: $4,854.50."
- Partial payments tracked with remaining balance
- Refund handling: agent records credit note and reversal journal entry

### US-2.5: Payment follow-up automation
**As** Maya, **I want** the agent to chase overdue invoices, **so that** I don't have to send awkward reminder emails.

Acceptance criteria:
- Configurable reminder schedule: 3 days before due, on due date, 7/14/30 days overdue
- Professional, customizable reminder email templates
- Per-client override: "Don't send reminders to Acme this month"
- Escalation after final reminder: agent asks user for instructions
- Aging report: "Show me overdue invoices" returns structured summary with total outstanding
- Late fee auto-calculation (if configured by user)

### US-2.6: Client management
**As** Maya, **I want** the agent to remember my clients and their payment patterns, **so that** I have complete visibility into each relationship.

Acceptance criteria:
- Client record: name, company, email, phone, billing address, payment terms, tax ID
- Per-client metrics: total billed, total paid, average days to pay, outstanding balance, lifetime value
- Client payment pattern learning: "Acme typically pays in 18 days"
- Client groups/tags for segmentation: "retainer clients", "project-based"
- Contact management: update details via Telegram
- Client statement generation: summary of all invoices and payments for a date range

---

## Epic 3: Accounts payable and vendor bills

### US-3.1: Bill tracking
**As** Raj, **I want to** track bills I owe to vendors, **so that** I know my total obligations and never miss a payment.

Acceptance criteria:
- Record a bill: "I owe $2,000 to CloudFlare, due April 15"
- Forward vendor invoice email to bot → agent extracts details and creates bill record
- Bill status tracking: pending, scheduled, paid, overdue
- Upcoming bills summary: "What bills do I have due this week?"
- Bill payment recording: "I paid the CloudFlare bill today"
- Automatic journal entry on payment: debit expense, credit cash

### US-3.2: Contractor payments and 1099 preparation
**As** Raj, **I want to** track payments to contractors, **so that** I can generate 1099-NEC forms at year-end.

Acceptance criteria:
- Contractor records: name, address, tax ID (SSN or EIN), payment terms
- Track payments per contractor across the year
- Alert when approaching $600 threshold: "You've paid Alex $550 this year. The next payment will trigger 1099-NEC reporting."
- Generate 1099-NEC data at year-end
- W-9 collection tracking: "Alex hasn't submitted a W-9 yet. Want me to send a request?"
- Bulk 1099 generation for all contractors

---

## Epic 4: Bookkeeping and double-entry accounting

### US-4.1: Automated journal entries
**As** Maya, **I want** every transaction to be properly recorded in double-entry format, **so that** my books are always balanced and audit-ready.

Acceptance criteria:
- Every expense, invoice, payment, refund, and fee creates a balanced journal entry
- Debit = credit enforced by database constraint (never LLM-advisory)
- Chart of accounts follows standard structure (assets 1000s, liabilities 2000s, equity 3000s, revenue 4000s, expenses 5000s-9000s)
- Manual journal entry support: "Post a $500 adjustment from owner's equity to office supplies"
- Journal entry explanation: "Why did you debit accounts receivable?" → agent explains the double-entry logic
- Voiding and reversing entries supported (never deletion)

### US-4.2: Bank feed connection and reconciliation
**As** Maya, **I want** the agent to reconcile my bank transactions automatically, **so that** my books match my bank.

Acceptance criteria:
- Connect bank via Plaid: checking, savings, credit card (read-only)
- Daily automatic transaction import
- Auto-matching engine: bank transactions matched to recorded expenses/income by amount, date, vendor
- Auto-merge: when a bank transaction matches a manually-entered expense, agent merges them (no duplicates)
- Unmatched transactions surfaced: "I see a $127.50 charge at Amazon on Mar 19 that I don't have a receipt for. What category? [Office supplies] [Personal] [Other]"
- Reconciliation status: "Your books are reconciled through March 15. 3 transactions need your attention."
- Never auto-categorize above configurable threshold without user confirmation
- Multi-account support: link multiple bank accounts and credit cards

### US-4.3: Sales tax tracking
**As** Raj, **I want** to track sales tax collected and owed, **so that** I can file accurate sales tax returns.

Acceptance criteria:
- Configure sales tax rates by jurisdiction (state, county, city)
- Sales tax auto-applied to invoices when applicable
- Tax-exempt clients supported
- Sales tax liability tracking: how much collected, how much remitted, how much owed
- Sales tax report by period: total collected, by jurisdiction
- Filing deadline reminders based on jurisdiction

### US-4.4: Chart of accounts management
**As** Raj, **I want** a proper chart of accounts, **so that** my reports are meaningful and my CPA is happy.

Acceptance criteria:
- Default chart of accounts for sole proprietor (Schedule C aligned), with option for LLC, S-Corp
- Full GAAP-compliant account structure: assets, liabilities, equity, revenue, COGS, expenses
- User-customizable: add, rename, merge, deactivate accounts
- Sub-accounts for detailed tracking: "Revenue > Consulting > Retainer" vs "Revenue > Consulting > Project"
- Account number auto-assignment following standard numbering
- Opening balance entry for new businesses or migrations from other software

---

## Epic 5: Tax planning and filing

### US-5.1: Real-time tax estimate
**As** Maya, **I want** to know my estimated tax liability at any time, **so that** I can plan quarterly payments and avoid surprises.

Acceptance criteria:
- Agent calculates running estimate: federal income tax (progressive brackets), self-employment tax (15.3% on 92.35% of net earnings), state income tax (configurable by jurisdiction)
- Accounts for: standard deduction ($14,600 single / $29,200 MFJ for 2024, updated annually), QBI deduction (20% of qualified business income), estimated payments already made, self-employed health insurance deduction, half of SE tax deduction, retirement contributions (SEP-IRA, Solo 401k)
- User asks: "What's my tax situation?" → Agent responds with: projected total tax liability, effective tax rate, marginal tax bracket, quarterly payment recommendation, comparison to prior year
- Auto-updates as new income/expenses are recorded
- Warns proactively: "You've earned $15,000 more than this time last year. Your quarterly estimate should increase by approximately $4,200."

### US-5.2: Proactive tax deduction optimization
**As** Maya, **I want** the agent to actively find deductions I'm missing, **so that** I minimize my tax burden legally.

Acceptance criteria:
- Agent reviews expenses against all Schedule C deduction categories and flags gaps: "You haven't logged any home office expenses this year. Do you work from home? You could deduct approximately $1,500."
- Timing strategies: "You're $3,000 below the next tax bracket. If you can accelerate $3,000 of expenses before Dec 31 (e.g., prepay January rent, buy equipment you've been considering), you'd save approximately $660 in taxes."
- Retirement contribution reminders: "You can still contribute up to $69,000 to a SEP-IRA for 2026 and deduct it. Based on your net income, your maximum contribution is $13,800."
- Health insurance deduction: "You paid $8,400 in health premiums this year. This is 100% deductible above the line for self-employed individuals."
- Depreciation opportunities: "That $2,800 computer you bought in March — you can expense the full amount under Section 179 this year, or depreciate it over 5 years. Expensing now saves $616 in taxes."
- Year-end tax planning summary (November each year): comprehensive optimization report with specific actions and estimated savings

### US-5.3: Quarterly estimated tax management
**As** Maya, **I want** the agent to calculate, remind, and track my quarterly estimated taxes, **so that** I avoid underpayment penalties.

Acceptance criteria:
- Calculates quarterly estimates using: annualized income method (based on actual YTD income) and prior year safe harbor (100%/110% of prior year)
- Recommends the lower of the two methods
- Reminders: 7 days and 3 days before each deadline (April 15, June 15, September 15, January 15)
- Provides: payment amount, IRS Direct Pay link, state tax payment link
- Records payment when confirmed: "I paid $3,200 quarterly estimate today via IRS Direct Pay"
- Tracks all four quarters with running over/under payment status
- Penalty estimation if underpaid: "You're $800 short on Q2. If you don't make it up, the estimated penalty is approximately $24."

### US-5.4: Tax filing preparation
**As** Maya, **I want** the agent to prepare my complete tax package, **so that** I can file myself or hand it to a CPA.

Acceptance criteria:
- Generates from ledger data: Schedule C (profit or loss from business), Schedule SE (self-employment tax), Schedule C detail by expense category, 1099 reconciliation (expected vs received), quarterly payment summary, home office deduction worksheet, vehicle/mileage deduction worksheet
- Export formats: PDF tax package, TurboTax import (TXF format), CSV for manual entry
- Agent pre-flight check: "Before I finalize your tax package, I have 4 questions: Did you use any equipment costing over $2,500? Did you have a home office? Did you pay for health insurance? Did you make retirement contributions?"
- CPA-ready package: all reports, journal entries, receipt images, and a cover letter summarizing the year
- Prior year comparison included in all reports

### US-5.5: Year-end closing
**As** Maya, **I want** the agent to close my books at year-end, **so that** the new year starts clean.

Acceptance criteria:
- Agent prompts year-end review in January: "Ready to close 2026? I need to verify a few things first."
- Closing checklist: all bank accounts reconciled, all invoices accounted for, all 1099s received, depreciation recorded, all recurring items current
- Period closing: locks prior year entries (new entries require explicit override with reason)
- Opening balance carry-forward to new year
- Year-end financial statements generated automatically

---

## Epic 6: Cash flow management and analytics

### US-6.1: Cash flow dashboard and forecasting
**As** Maya, **I want** to see my cash flow at a glance and know what's coming, **so that** I can plan spending and avoid shortfalls.

Acceptance criteria:
- Current cash position across all connected accounts
- 30/60/90-day cash flow projection using: known recurring expenses, expected invoice payments (based on per-client payment patterns), estimated tax payments, seasonal patterns from prior year data
- Proactive warnings: "Your projected cash balance drops to $1,200 on March 28 — you have $3,800 in bills due and only $2,600 expected income. Consider following up on the overdue Acme invoice ($5,000)."
- Telegram: "How's my cash flow?" returns text summary with key numbers
- Dashboard: interactive chart with drill-down by category

### US-6.2: Earnings and profitability projection
**As** Maya, **I want** to project my annual earnings and track profitability, **so that** I can plan my business and personal finances.

Acceptance criteria:
- Annual revenue projection: based on YTD actuals + historical patterns + pipeline
- Confidence bands: optimistic, expected, conservative
- Net profit projection: revenue - expenses - estimated taxes
- Per-client profitability: revenue from client minus allocated time/expenses
- Scenario modeling: "What if I land the $30k project?" → agent shows updated annual projection
- Month-over-month and year-over-year trend comparisons
- Profit margin tracking: gross margin, net margin, operating margin

### US-6.3: Expense analytics and insights
**As** Maya, **I want** deep insight into where my money goes, **so that** I can cut waste and optimize spending.

Acceptance criteria:
- Category breakdown: pie chart and table (month, quarter, year)
- Trend analysis: "Your software subscriptions increased 40% vs last quarter — you added 3 new services totaling $127/month"
- Anomaly detection: "Your travel expenses are 3x your 6-month average this month"
- Vendor analysis: top vendors by total spend, payment frequency, category
- Year-over-year comparison: same month/quarter vs prior year
- Effective tax rate tracking over time
- Business vs personal spending ratio (if tracking both)

### US-6.4: Financial reports
**As** Raj, **I want** standard financial reports, **so that** I can share them with my bank, CPA, or investors.

Acceptance criteria:
- Profit and loss statement (P&L): monthly, quarterly, annual, custom date range, with year-over-year comparison
- Balance sheet: as of any date, with prior period comparison
- Cash flow statement: operating, investing, financing activities
- Trial balance: debit/credit totals for all accounts
- Accounts receivable aging: current, 1-30, 31-60, 61-90, 90+ days
- Accounts payable summary
- Sales tax report: collected, remitted, owed, by jurisdiction
- General ledger detail: all entries for any account or date range
- All reports exportable as PDF, CSV, and viewable on web dashboard
- Telegram: "Send me my P&L for Q1" → agent generates and sends PDF

---

## Epic 7: Interface layer

### US-7.1: Telegram bot — natural language interface
**As** Maya, **I want** to talk to the agent naturally, **so that** I don't have to learn commands or navigate menus.

Acceptance criteria:
- Agent understands varied phrasings: "I spent $45 on lunch", "Record a $45 meal expense", "45 bucks at the restaurant today", "Had a working lunch for forty-five dollars"
- Multi-intent messages: "Invoice Acme $5k and record the $45 lunch" → executes both
- Contextual follow-ups: User: "Record $200 at Best Buy" → Agent: "Office supplies?" → User: "No, it was a monitor for the home office" → Agent re-categorizes
- Voice note support: speech-to-text → intent parsing
- Inline keyboard buttons for all confirmations and common actions
- Quick actions: /expense /invoice /balance /reports /tax /help
- Never guesses on financial amounts — always confirms if ambiguous
- Supports English; architecture supports adding languages later

### US-7.2: Web dashboard
**As** Maya, **I want** a visual dashboard, **so that** I can see my financial health at a glance.

Acceptance criteria:
- Single-page overview: revenue vs expense chart (12-month), cash position, outstanding invoices, upcoming tax deadlines, recent transactions, profit margin trend
- Transaction management: searchable, filterable, inline-editable table
- Report viewer: interactive P&L, balance sheet, cash flow with drill-down
- Expense analytics: category breakdown, vendor analysis, trend charts
- Tax dashboard: current estimate, quarterly payments, deduction tracking, bracket visualization
- Invoice management: view, edit, resend, void, mark as paid
- Client directory with per-client financial summary
- Settings: chart of accounts, tax configuration, integration connections, user preferences
- Authentication: Telegram Login Widget (no separate account creation)
- Responsive: desktop and tablet optimized

### US-7.3: Mobile app (Phase 4+)
**As** Maya, **I want** a mobile app for quick actions on the go, **so that** I can snap receipts and check balances from my phone.

Acceptance criteria:
- Receipt capture with camera (fast OCR flow)
- GPS mileage tracking (background, battery-efficient)
- Quick expense entry
- Balance and cash flow check
- Invoice status notifications
- Push notifications for: payments received, overdue invoices, tax deadlines, agent questions
- iOS and Android (React Native or Flutter)
- Syncs with same account (no separate login)

---

## Epic 8: Collaboration and accountant access

### US-8.1: CPA/accountant portal
**As** Linda (CPA), **I want** read-only access to my client's books, **so that** I can review their financials and prepare tax returns efficiently.

Acceptance criteria:
- Invite accountant via email or link with role assignment
- Roles: viewer (read-only reports), editor (can post adjustments), admin (full access)
- Accountant sees: all reports, journal entries, chart of accounts, tax package, receipt archive
- Accountant can leave notes on transactions: "Need documentation for this expense"
- Notes appear as agent messages to the user: "Your CPA Linda left a note: 'Need documentation for the $2,800 Best Buy expense.'"
- No additional charge for accountant access
- Audit log visible to accountant: who changed what, when

### US-8.2: Multi-user access
**As** Raj, **I want** team members to have limited access, **so that** my bookkeeper can enter expenses without seeing everything.

Acceptance criteria:
- Roles: owner (full access), bookkeeper (transactions, no reports), viewer (reports only)
- Each user has their own Telegram connection
- Actions by non-owner users are logged and optionally require owner approval
- Role-based feature visibility in web dashboard

---

## Epic 9: Integrations

### US-9.1: Stripe payment processing
**As** Maya, **I want** Stripe integration, **so that** I can accept credit card and ACH payments on invoices.

Acceptance criteria:
- Stripe Connect OAuth setup via web dashboard
- Invoice payment links auto-generated
- Webhook handling: payment succeeded, payment failed, refund issued, dispute opened, payout completed
- Fee tracking: processing fees auto-categorized as business expense
- Payout reconciliation: matches Stripe payouts to bank deposits
- Refund workflow: agent creates credit note and reversal journal entry
- Payment processing rates displayed transparently

### US-9.2: Plaid bank connection
**As** Maya, **I want** my bank accounts connected, **so that** transactions import automatically.

Acceptance criteria:
- Plaid Link via web dashboard
- Supports: checking, savings, credit cards
- Daily sync (real-time where Plaid supports it)
- Read-only (never moves money)
- Multi-account: link unlimited accounts
- Auto-reconnection handling: if link breaks, agent notifies and provides re-auth link
- Transaction categorization begins immediately on import
- Historical import: up to 24 months of past transactions on initial connection

### US-9.3: Email forwarding for receipts and invoices
**As** Maya, **I want** to forward receipt emails to a dedicated address, **so that** the agent processes them automatically.

Acceptance criteria:
- Each tenant gets a unique email address: maya-receipts@agentbooks.ai
- Forwarded emails parsed for: attachments (receipt images, PDF invoices), email body (order confirmations), sender (vendor identification)
- Agent processes and confirms via Telegram: "Got your Amazon order confirmation — $89.50 office supplies. [Correct] [Edit]"

### US-9.4: Data export and portability
**As** Maya, **I want** to export all my data, **so that** I can switch systems or give data to my CPA.

Acceptance criteria:
- Export formats: CSV (transactions, journal entries, invoices), QBO (QuickBooks interchange), PDF (all reports), TXF (TurboTax), ZIP (all receipts organized by year/category)
- Full data export via API and web dashboard
- Import from Wave and QuickBooks: CSV/QBO format migration tool
- Data retention: minimum 7 years (IRS requirement)
- Right to deletion: user can request full data purge (with 30-day grace period)

---

## Epic 10: Onboarding and setup

### US-10.1: Guided setup via Telegram
**As** Maya, **I want** a simple onboarding that takes less than 5 minutes, **so that** I start using the agent immediately.

Acceptance criteria:
- Onboarding conversation flow:
  1. "Hi! I'm your bookkeeping agent. What type of business do you run?" → [Freelancer/consultant] [Agency/studio] [Retail/shop] [Other]
  2. "What's your business name and location?" (for tax jurisdiction)
  3. "How do you mainly get paid?" → [Client invoices] [Online sales] [Both]
  4. "Let's connect your bank account for automatic tracking." → Plaid Link
  5. "Want to connect Stripe for invoice payments?" → Stripe OAuth
  6. "All set! Send me a receipt photo or type an expense to get started."
- Skip any step and complete later
- Agent builds initial chart of accounts based on business type
- Pre-configured tax settings based on jurisdiction (state selection)

### US-10.2: Migration from other software
**As** Maya, **I want** to import my existing data from Wave or QuickBooks, **so that** I don't start from scratch.

Acceptance criteria:
- Import from Wave: CSV export → AgentBooks importer
- Import from QuickBooks: QBO/IIF file → AgentBooks importer
- Import maps: chart of accounts, transactions, clients, invoices, payments
- Duplicate detection: if bank is also connected, agent de-duplicates imported vs live transactions
- Import summary: "Imported 342 transactions, 8 clients, and 23 invoices from Wave. 3 transactions need manual review."

---

## Non-functional requirements

### NFR-1: Security and compliance
- All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- Telegram bot webhook over HTTPS
- Bank and payment credentials in encrypted vault (never in database)
- PCI-DSS compliance for any payment data handling
- Audit log: every create, update, delete logged with timestamp, actor, before/after values
- Default: no raw financial amounts in LLM prompts to external providers; self-hosted inference preferred
- SOC 2 Type II readiness by Phase 5

### NFR-2: Financial accuracy
- Double-entry balance enforced by database constraint (not application logic)
- All amounts stored as integer cents (no floating-point in financial path)
- Tax calculations use published IRS rates/brackets, updated annually with versioning
- Reconciliation discrepancies flagged immediately, never silently absorbed
- Every correction is a reversal + new entry (never mutation of existing records)
- All events immutable (append-only event store)

### NFR-3: Performance
- Telegram response: < 3 seconds for text, < 10 seconds for OCR
- Dashboard load: < 2 seconds with 1 year of data (10,000 transactions)
- Bank sync: < 30 seconds for daily pull
- Report generation: < 5 seconds for any standard report
- Agent multi-step operations: < 15 seconds total

### NFR-4: Reliability
- 99.9% uptime for Telegram bot and web dashboard
- Idempotent tool calls (retries never create duplicate transactions)
- Saga compensation for failed multi-step operations
- Daily automated backup; point-in-time recovery to any moment in the last 30 days
- Graceful LLM degradation: if LLM provider is down, non-LLM operations continue (bank sync, Stripe webhooks, scheduled reminders)

### NFR-5: Privacy and data ownership
- User owns all data; full export and deletion on request
- No sharing with third parties beyond integration partners
- GDPR-compliant data handling and consent management
- Configurable data residency (US, Canada, EU)
- Transparent privacy policy: what data goes where, especially re: LLM providers

### NFR-6: Scalability targets (MVP)
- Support 1,000 active tenants on a single deployment
- 100 concurrent Telegram sessions
- 50,000 transactions per tenant per year
- 10 connected bank accounts per tenant
- Growth path to 100,000 tenants via NaaP horizontal scaling
