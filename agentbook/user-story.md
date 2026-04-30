# AgentBook — User Stories & Target Users

## Target User Groups

### Primary: Solo Freelancers & Independent Consultants
**"Maya" — IT Consultant, 32, Toronto**
- Bills 2–5 clients, $80K–$250K/year revenue
- Tracks expenses on the go (receipts, subscriptions, travel)
- Dreads tax season — spends $1,500/year on a CPA
- Wants to focus on client work, not bookkeeping
- Currently uses: spreadsheet or QuickBooks Self-Employed ($20/mo)
- **Pain:** Spends 5+ hours/month on bookkeeping. Misses deductions. Surprised by tax bills.

### Secondary: Small Creative Agencies (2–10 people)
**"Alex" — Design Agency Owner, 40, Austin**
- Manages 5–10 active client projects
- Has 2 contractors + 1 employee
- Tracks time by project, bills monthly retainers + hourly overages
- Needs client profitability visibility
- Currently uses: QuickBooks Simple Start + Harvest for time tracking
- **Pain:** No single tool connects invoicing, time, expenses, and profitability. Pays $75/mo for multiple tools.

### Tertiary: Side-Hustle Professionals
**"Jordan" — Software Engineer by day, e-commerce seller on weekends**
- Needs clean separation of business vs personal expenses
- Files Schedule C alongside W-2 income
- < $50K side income
- Currently uses: nothing or Wave (free)
- **Pain:** Forgets to track expenses. Panics at tax time. Doesn't know what's deductible.

---

## User Stories by Category

> Stories marked with **[MOAT]** are AI-native capabilities that no competitor offers.
> Stories marked with **[HIGH VALUE]** deliver the most measurable user value (time/money saved).

---

### A. GETTING STARTED (Onboarding)

| # | User Story | Value |
|---|-----------|-------|
| A1 | As a new user, I can complete onboarding in under 10 minutes by following a 7-step wizard that sets up my jurisdiction, currency, fiscal year, and chart of accounts. | Reduces friction to zero — no accounting knowledge needed |
| A2 | As a Canadian consultant, I can select my jurisdiction (Canada) and have GST/HST, T2125 categories, CRA installment dates, and CPP/EI rules automatically configured. | Jurisdiction-aware from day one |
| A3 | As a US freelancer, I can select my state and have Schedule C categories, IRS quarterly deadlines, and SE tax rules loaded automatically. | No manual tax setup |
| A4 | As a user, I can connect my Telegram account and start recording expenses by sending text or photos — no app download required. | Telegram-first UX removes adoption barrier |
| A5 | As a user, I can import my existing expenses from a CSV file (bank export) and have them auto-mapped and categorized. | **[HIGH VALUE]** Eliminates data migration pain |

---

### B. EXPENSE TRACKING

| # | User Story | Value |
|---|-----------|-------|
| B1 | As a freelancer, I can type "coffee $5.50 Starbucks" in Telegram and have it automatically recorded, categorized as Meals & Entertainment, and linked to the vendor. | **[HIGH VALUE]** Zero-friction expense recording |
| B2 | As a consultant, I can snap a photo of a receipt in Telegram and have the agent extract vendor, amount, date, and category using OCR — and auto-record it. | **[HIGH VALUE]** [MOAT] Receipt → expense in 3 seconds |
| B3 | As a user, after the agent records 50+ of my expenses, 95%+ of future expenses are auto-categorized correctly without any input from me. | **[MOAT]** Agent learns my patterns — no competitor does this |
| B4 | As a freelancer, I can split a $200 Costco receipt into $150 business (office supplies) and $50 personal, and only the business portion hits my books. | Clean business/personal separation |
| B5 | As a user, after recording 3+ similar monthly expenses from the same vendor, the agent suggests "Make this a recurring expense?" and I can accept with one tap. | **[MOAT]** Agent detects patterns I don't notice |
| B6 | As a user, I can connect my bank account via Plaid and have transactions auto-imported, matched to recorded expenses, and reconciled. | **[HIGH VALUE]** Eliminates manual data entry |
| B7 | As a consultant, I can track mileage for client visits using GPS logging, and the agent auto-calculates the deduction at the current IRS/CRA rate. | Mileage deduction capture |
| B8 | As a user, I never lose a receipt — every receipt photo is stored and linked to its expense, searchable by vendor or date. | Audit protection |

---

### C. INVOICING & GETTING PAID

| # | User Story | Value |
|---|-----------|-------|
| C1 | As a consultant, I can say "Invoice Acme $5,000 for March consulting" in Telegram and get a professional invoice generated with proper line items. | **[HIGH VALUE]** Invoice creation in 5 seconds |
| C2 | As a freelancer, I can generate a professional PDF invoice with my business name, logo, line items, tax, and payment terms — and email it to the client in one click. | **[HIGH VALUE]** Professional invoicing |
| C3 | As a user, I can set up recurring invoices for retainer clients ($5,000/month to TechCorp, net-15) and have them auto-generated and optionally auto-sent. | **[HIGH VALUE]** Set-and-forget billing |
| C4 | As a freelancer, when an invoice is 7 days overdue, the agent sends a gentle reminder. At 14 days, a firm reminder. At 30 days, I'm alerted to follow up personally. | **[MOAT]** Automated, tone-escalating collections |
| C5 | As a user, I can see exactly who owes me money, how much, and how long it's been overdue in an aging report. | Cash flow visibility |
| C6 | As a consultant, I can record partial payments against an invoice and see the remaining balance update in real-time. | Flexible payment tracking |
| C7 | As a user, I can create an estimate/quote, send it to the client, and convert it to an invoice with one click when approved. | Full quote-to-cash workflow |
| C8 | As an agency owner, I can issue a credit note against an invoice when I need to adjust the amount, and the journal entries auto-reverse correctly. | Proper accounting for adjustments |
| C9 | As a user serving international clients, I can create invoices in USD, CAD, GBP, EUR, or AUD with correct currency formatting. | **[HIGH VALUE]** Multi-currency support |
| C10 | As a user, I can accept online payments via Stripe directly from the invoice. | Faster payment collection |

---

### D. TIME TRACKING & PROJECT MANAGEMENT

| # | User Story | Value |
|---|-----------|-------|
| D1 | As a consultant, I can start/stop a timer via Telegram or the web dashboard and log billable time against a client or project. | Capture every billable minute |
| D2 | As a user, I can see all unbilled hours across clients and generate invoices directly from unbilled time entries. | **[HIGH VALUE]** No revenue leakage |
| D3 | As an agency owner, I can see project profitability — hours logged vs budget, effective hourly rate, and whether we're over/under scope. | Scope creep detection |
| D4 | As a consultant, I can set hourly rates per project or client, and invoices auto-calculate from logged time. | Accurate billing |

---

### E. TAX & COMPLIANCE

| # | User Story | Value |
|---|-----------|-------|
| E1 | As a freelancer, I can ask "What's my tax situation?" at any time and get an instant, real-time tax estimate — income tax, self-employment tax, effective rate. | **[HIGH VALUE]** [MOAT] Real-time tax awareness |
| E2 | As a Canadian consultant, the agent reminds me 7 days before my CRA quarterly installment is due, with the exact amount to pay. | **[HIGH VALUE]** [MOAT] Never miss a deadline again |
| E3 | As a US freelancer, the agent reminds me before IRS quarterly estimates (Apr 15, Jun 15, Sep 15, Jan 15) with calculated amounts. | **[HIGH VALUE]** [MOAT] Automated tax compliance |
| E4 | As a user, the agent proactively finds deductions I'm missing: "You haven't claimed home office expenses. Work from home? You could save ~$2,100." | **[HIGH VALUE]** [MOAT] Money-saving AI no competitor has |
| E5 | As a Canadian consultant, at year-end the agent generates a complete T2125 tax package with all lines populated, GST/HST summary, vehicle expenses, and a CPA cover letter. | **[HIGH VALUE]** Tax prep that costs $1,500 from a CPA |
| E6 | As a US freelancer, I get a complete Schedule C package with categorized expenses mapped to IRS lines. | Tax filing readiness |
| E7 | As a user, the agent tracks contractor payments and alerts me when I approach the $600 (US) or $500 (CA) reporting threshold. | 1099/T4A compliance |
| E8 | As a user, I can track and auto-apply GST/HST (Canada) or state sales tax (US) on my invoices. | Sales tax compliance |

---

### F. FINANCIAL INTELLIGENCE & INSIGHTS

| # | User Story | Value |
|---|-----------|-------|
| F1 | **As a freelancer, I can ask any financial question in plain English — "How much did I spend on travel last quarter?" — and get an instant, accurate answer.** | **[HIGH VALUE]** [MOAT] Ask your books like asking a person |
| F2 | **As a user, the agent warns me: "Your cash cushion is only 1.4 months. Ideal is 3 months. Follow up on the $5,000 overdue invoice from WidgetCo."** | **[HIGH VALUE]** [MOAT] Proactive cash management |
| F3 | **As a user, the agent detects: "Your SaaS spend jumped 60% this month. You added 3 new tools totaling $72/mo ($864/year). Want me to track which ones you use?"** | **[MOAT]** Expense spike detection |
| F4 | **As a user, the agent warns: "Your TechCorp contract ends next month — that's 60% of your revenue. Start the renewal conversation?"** | **[MOAT]** Revenue cliff early warning |
| F5 | **As a user, the agent advises: "Buy that laptop before Dec 31 and save $616 in taxes (Section 179 + staying in the lower bracket)."** | **[MOAT]** Optimal timing for purchases |
| F6 | As a user, I receive a daily pulse at 8 AM: "Today: $340 in, $127 out. Balance: $12,450. 1 item needs attention." | **[MOAT]** Proactive daily briefing |
| F7 | As a user, I receive a weekly review every Monday: "Revenue $4,200, expenses $1,340. Top spend: Software. Tax rate: 28.3%." | Weekly financial awareness |
| F8 | As a user, the agent celebrates my milestones: "You've passed $100,000 in revenue this year!" | Motivation + awareness |
| F9 | As an agency owner, I can see client health scores — lifetime value, effective hourly rate, payment reliability, scope creep risk — and the agent recommends "raise your rate for WidgetCo." | **[HIGH VALUE]** [MOAT] Client profitability intelligence |
| F10 | As a user, I can see P&L, Balance Sheet, Cash Flow Statement, and Trial Balance reports for any date range. | Standard financial reporting |

---

### G. WHAT-IF SIMULATION (Financial Digital Twin)

| # | User Story | Value |
|---|-----------|-------|
| G1 | **As a freelancer, I can ask "What if I hire a contractor at $5,000/month?" and see a 12-month cash projection, tax impact, and break-even timeline.** | **[HIGH VALUE]** [MOAT] Financial decision support |
| G2 | **As a user, I can simulate "What if I lose my biggest client?" and see how long my cash lasts and what I need to do.** | **[MOAT]** Risk assessment |
| G3 | **As a user, I can simulate buying equipment and see the depreciation schedule, tax savings, and cash flow impact.** | **[MOAT]** Capital planning |
| G4 | As a user, I can describe scenarios in plain English and the agent runs the simulation using Gemini AI. | [MOAT] Natural language simulation |

---

### H. WORKFLOW AUTOMATION

| # | User Story | Value |
|---|-----------|-------|
| H1 | **As a user, I can create automations: "Every Friday, if Acme hasn't paid, send a gentle reminder. After 30 days, escalate to me."** | **[HIGH VALUE]** [MOAT] Custom workflow composition |
| H2 | As a user, I can describe workflows in plain English and the agent creates them using AI. | [MOAT] Natural language → workflow |
| H3 | As a user, I can pause, resume, and delete automations, and see execution history. | Full automation lifecycle |
| H4 | As a user, automations can trigger on schedules (every Monday), events (new expense), or conditions (invoice overdue 14+ days). | Flexible triggers |

---

### I. AI AGENT CUSTOMIZATION

| # | User Story | Value |
|---|-----------|-------|
| I1 | As a user, I have 4 AI agents (Bookkeeper, Tax Strategist, Collections, Insights) each with specialized skills. | Specialized expertise |
| I2 | As a user, I can set each agent's approach (gentle → assertive), auto-approve toggle, notification frequency, and AI model tier. | Full control |
| I3 | As a user, my agents get smarter over time — the Bookkeeper learns my vendors, the Collections agent learns per-client optimal timing. | **[MOAT]** Self-improving agents |
| I4 | **As a user, I can customize my agent's personality: "Always round up tax estimates" or "Be concise — I'm a numbers person."** | **[MOAT]** Personalized CFO |
| I5 | As a user, my agents auto-adapt — if I correct them a lot, they ask more before acting. If I never correct them, they increase autonomy. | **[MOAT]** Trust curve |
| I6 | As a busy freelancer, I can turn on "autopilot mode" and the agent handles everything — I only review a monthly summary. | **[MOAT]** Full financial autopilot |

---

### J. PLATFORM & ACCESS

| # | User Story | Value |
|---|-----------|-------|
| J1 | As a user, I can access AgentBook from any device via the web dashboard (PWA-ready). | Universal access |
| J2 | As a user, I can share read-only access with my CPA via a secure token link. | CPA collaboration |
| J3 | As a team, we can have multiple users with roles (owner, bookkeeper, viewer, CPA). | Multi-user support |
| J4 | As a user, I can export all my data as CSV or JSON at any time. | Data portability |
| J5 | As a bilingual Canadian, I can use AgentBook in English or French. | i18n (en + fr-CA) |
| J6 | As a user, every action is audited in an immutable event log — I can see exactly what the agent did and why. | Full audit trail |
| J7 | As a user, I have a full REST API for integrating AgentBook with other tools. | API-first platform |

---

## Value Scoring Summary

### Highest-Value Stories (Save $500+/year or 3+ hours/month)

| Story | User Saves | Why It Matters |
|-------|-----------|----------------|
| B2 | 3 hrs/mo | Receipt photo → expense in 3 seconds (vs 15 min manual) |
| B3 | 4 hrs/mo | 95%+ auto-categorization (vs clicking through every transaction) |
| C3 | 2 hrs/mo | Auto-recurring invoices (vs manually creating every month) |
| E2/E3 | $500/yr | Never miss quarterly payments (avoids penalties) |
| E4 | $2,000/yr | Agent finds deductions you didn't know about |
| E5 | $1,500/yr | Tax package replaces CPA prep work |
| F1 | 1 hr/mo | Ask questions vs searching through reports |
| F2 | $1,000+/yr | Cash cushion warnings prevent overdrafts |
| G1 | Priceless | Financial decision confidence |

### Unique MOAT Features (No Competitor Offers These)

1. **Self-learning expense categorization** — Gets smarter, not just rules-based
2. **Proactive money moves** — Agent warns you BEFORE problems happen
3. **Conversational financial memory** — Ask anything in English
4. **Financial digital twin** — Simulate any what-if scenario
5. **Autonomous workflow composition** — Describe automations in English
6. **Per-agent personality adaptation** — Agent matches your communication style
7. **Trust-curve autonomy** — Agent earns more autonomy over time
8. **Multi-agent collaboration** — 4 specialized agents working as a team

---

## How AgentBook Replaces a $1,500/year CPA

| CPA Service | AgentBook Feature | Cost Comparison |
|-------------|------------------|-----------------|
| Monthly bookkeeping ($100/mo) | Zero-input bookkeeping + auto-categorization | Included |
| Quarterly tax prep ($200/quarter) | Real-time tax estimates + quarterly reminders | Included |
| Year-end tax package ($500) | One-tap T2125/Schedule C generation | Included |
| Deduction planning ($200) | Proactive deduction hunting all year | Included |
| Financial advice ($150/hr) | Conversational memory + what-if simulator | Included |
| **Total: $2,300/year** | **AgentBook: $12/month ($144/year)** | **Saves $2,156/year** |

---

*Last updated: 2026-03-30. Based on Phase 12 codebase with 94+ API endpoints, 7 AGI features, 22 proactive handlers, 4 autonomous agents, 4 jurisdiction packs.*
