# AgentBook — Beyond MVP: Competitive Analysis & Agent-Native Roadmap

## Where We Are Today (MVP Complete)

AgentBook MVP delivers a functional agent-based accounting system across 5 phases with 17 skills, 18 proactive handlers, 23 Prisma models, 4 jurisdiction packs (US, CA, UK, AU), and 60 passing E2E tests. It handles expense tracking, invoicing, tax estimation, bank reconciliation, and proactive financial guidance via Telegram.

**But to truly compete with QuickBooks ($20/mo, 4.5M subscribers) and Wave (free, 2M users), AgentBook must go beyond feature parity. It must offer something neither can: an agent that works FOR you, not a tool you work WITH.**

---

## Part 1: Competitive Gap Analysis

### What QuickBooks Has That We Don't (Yet)

| Feature | QB Status | AgentBook Status | Gap | Priority |
|---------|-----------|-----------------|-----|----------|
| **Payroll** | Full payroll processing, direct deposit, tax filing | Not implemented | Critical for small businesses with employees | High |
| **Inventory tracking** | SKU management, cost tracking, reorder alerts | Not implemented | Essential for product-based businesses | Medium |
| **Time tracking** | Built-in timer, project-based billing | Not implemented | Key for consultants who bill hourly | High |
| **Purchase orders** | PO creation, vendor management workflow | Not implemented | Important for agencies/studios | Medium |
| **Mobile app** | Native iOS + Android | Telegram bot only | App Store presence matters for discovery | Medium |
| **Direct bank feeds** | Real-time Plaid feeds + manual import | Plaid skill (framework only, not live) | Must be live for daily use | Critical |
| **Auto-categorization rules** | ML-based + user rules | LLM-based (framework, not production) | LLM approach is better but needs tuning | High |
| **Recurring invoices** | Auto-send on schedule | Model exists, automation not wired | Easy win | Medium |
| **Multi-currency invoicing** | Send invoices in any currency | Framework exists, not in invoice flow | Easy win | Low |
| **Reports library** | 65+ report types | 5 reports (P&L, BS, CF, TB, aging) | Need 10-15 more for CPA satisfaction | Medium |
| **Accountant access** | Full accountant collaboration | CPA token exists, no dedicated UI | Need CPA dashboard | Medium |
| **App marketplace** | 750+ integrations | Skill marketplace (framework only) | Not blocking initially | Low |

### What Wave Has That We Don't (Yet)

| Feature | Wave Status | AgentBook Status | Gap |
|---------|-------------|-----------------|-----|
| **Free forever core** | Free invoicing + accounting | Pricing not finalized | Must have free tier |
| **Receipt scanning** | Photo OCR in mobile app | Telegram photo OCR (framework) | Need production LLM connection |
| **Personal finance view** | Separate personal tracking | isPersonal flag exists | Need dedicated personal dashboard |
| **Payment processing** | Wave Payments (2.9%+$0.60) | Stripe framework | Need live Stripe Connect |

### Where Neither Competitor Can Match AgentBook

This is the critical differentiator — agent-native capabilities that are architecturally impossible for QB/Wave to bolt on:

| Agent-Native Capability | QB/Wave | AgentBook |
|------------------------|---------|-----------|
| **Proactive cash flow warnings** | None | 18 proactive handlers |
| **Tax deduction hunting** | None | Agent scans expenses, suggests missed deductions |
| **Natural language everything** | None | "Invoice Acme $5K for March consulting" |
| **Receipt → expense in 10 seconds** | Manual upload + categorize | Snap photo, agent reads + categorizes + records |
| **Learning from corrections** | Static rules | Pattern memory with EMA, drift detection |
| **Client payment prediction** | None | "Acme typically pays in 18 days" |
| **Scenario modeling** | None | "What if I prepay $3K in expenses?" → instant tax impact |
| **Engagement-driven notifications** | Static alerts | Frequency tuning based on what user acts on |
| **Multi-modal input** | Web form only | Text + photo + document + voice (Telegram) |
| **Jurisdiction extensibility** | Hardcoded per country | Jurisdiction packs, add country without code changes |

---

## Part 2: Agent-Native Epics (Beyond Traditional Accounting)

These are capabilities that **only an agent-native system can deliver**. They represent AgentBook's moat.

### Epic A: The Financial Copilot

> "AgentBook doesn't just record transactions. It thinks about your money the way a great CFO would."

**US-A.1: Autonomous Financial Advisor**
As a freelancer, I want the agent to proactively analyze my financial situation and recommend actions without me asking, so that I make better financial decisions.

Acceptance criteria:
- Agent identifies that I'm spending $400/mo on SaaS but only actively using 3 of 7 tools → "Cancel these 4 subscriptions to save $2,400/year"
- Agent notices income is seasonal (high in Q1/Q3, low in Q2/Q4) → "Set aside 20% of Q1 income for Q2 expenses"
- Agent detects that a client's payment behavior is deteriorating → "Acme's average payment time increased from 18 to 35 days. Consider requiring 50% upfront."
- Agent recognizes tax-loss harvesting opportunity → "Your equipment is depreciating. Consider replacing the $2,800 laptop now to capture the Section 179 deduction in this tax year."

**US-A.2: Smart Pricing Recommendations**
As a consultant, I want the agent to analyze my billing data and suggest pricing changes, so that I maximize revenue.

Acceptance criteria:
- Agent calculates effective hourly rate per client (including unbilled admin time)
- Agent identifies lowest-paying clients and suggests rate increases
- Agent benchmarks rates against industry data (from public sources)
- "Your effective rate for WidgetCo is $85/hr after accounting for scope creep. Your other clients average $140/hr."

**US-A.3: Cash Flow Auto-Pilot**
As a business owner, I want the agent to automatically manage cash flow timing, so that I never have a cash crunch.

Acceptance criteria:
- Agent learns payment patterns per client and projects cash position daily for 90 days
- When projected balance drops below threshold: agent recommends specific actions (chase invoice X, delay expense Y, or draw from credit line Z)
- Agent can auto-send payment reminders at optimal times (based on when client typically pays)
- "I've scheduled a reminder to Acme for next Tuesday — that's when they usually process payments"

### Epic B: The Learning Engine

> "Every interaction makes AgentBook smarter. After 6 months, it knows your business better than you do."

**US-B.1: Business Intelligence from Patterns**
As a freelancer, I want the agent to discover patterns in my financial data that I can't see, so that I get insights a human bookkeeper would miss.

Acceptance criteria:
- Agent detects seasonal revenue patterns → "Your revenue peaks in March and September. Consider offering Q2/Q4 retainers to smooth income."
- Agent identifies expense creep → "Your average monthly expenses increased 12% over 6 months, mostly from 4 new SaaS subscriptions."
- Agent finds client concentration risk → "73% of your revenue comes from 2 clients. Diversification recommended."
- Agent tracks personal vs business expense ratio → "Your personal expenses on the business card increased 20%. Consider a separate card."

**US-B.2: Adaptive Categorization**
As a user, I want the agent to learn my categorization preferences perfectly, so that after 30 days I never have to correct it.

Acceptance criteria:
- Agent tracks categorization accuracy per vendor and per category
- After 30 days of active use, auto-categorization accuracy exceeds 95%
- When accuracy drops (vendor changes category), agent detects drift and asks: "You usually categorize Amazon as Office Supplies, but your last 3 purchases were personal. Should I update the pattern?"
- Agent learns time-of-day patterns: "Uber charges during work hours → Travel; evenings/weekends → Personal"

**US-B.3: Predictive Tax Optimization**
As a self-employed person, I want the agent to continuously optimize my tax strategy throughout the year, not just at tax time.

Acceptance criteria:
- Monthly tax position analysis: "You're on track to owe $14,200. Here are 3 actions to reduce it by $2,100."
- Quarterly installment optimization: "Based on your income pattern, you can use the annualized method to save $800 on Q2 installment."
- Year-end sprint (November): comprehensive action plan with deadlines and estimated savings per action
- Multi-year planning: "If you contribute $6,500 to SEP-IRA this year, your 3-year tax savings would be $4,800."

### Epic C: The Collaboration Network

> "AgentBook connects you with your CPA, your clients, and your team — all through the agent."

**US-C.1: Agent-to-CPA Handoff**
As a freelancer, I want to give my CPA agent-level access to my books, so that tax prep takes 1 hour instead of 10.

Acceptance criteria:
- CPA gets a dedicated portal with read-only access to all data
- CPA can leave notes on specific transactions: "Need documentation for this $2,800 expense"
- Notes appear as agent messages to the user via Telegram
- Agent auto-generates a "CPA Package" with all reports, receipts, and tax forms organized
- CPA can approve/adjust year-end entries through the portal

**US-C.2: Client Self-Service Payment Portal**
As an invoicing user, I want my clients to have a branded payment page, so that getting paid is frictionless.

Acceptance criteria:
- Each invoice has a unique payment link
- Client sees: invoice details, payment methods (card, bank transfer), partial payment option
- Payment automatically recorded in AgentBook with correct journal entry
- Client receives confirmation email
- Recurring clients can set up auto-pay

**US-C.3: Team Financial Visibility**
As a micro-agency owner, I want team members to see relevant financial data based on their role, so that everyone has the context they need.

Acceptance criteria:
- Bookkeeper: can record expenses and view transaction history
- Project manager: can see per-project revenue and expenses
- Founder: full access including tax, reports, and settings
- All role actions logged for audit

### Epic D: The Automation Engine

> "AgentBook doesn't just respond to events. It orchestrates multi-step financial workflows autonomously."

**US-D.1: Invoice-to-Cash Automation**
As a freelancer, I want the agent to manage the entire invoice lifecycle autonomously, so that I get paid faster with zero effort.

Acceptance criteria:
- Agent detects completed work (from time entries or manual trigger)
- Agent drafts invoice, sends for approval (one-tap in Telegram)
- Agent sends invoice to client
- Agent sends payment reminders on schedule (adjustable per client)
- Agent detects payment via Stripe webhook → records, reconciles, celebrates
- Agent handles partial payments, disputes, refunds
- End-to-end: work done → money in bank, with human in the loop only for approval

**US-D.2: Expense-to-Deduction Pipeline**
As a self-employed person, I want every expense to automatically flow through to my tax return, so that I never miss a deduction.

Acceptance criteria:
- Expense recorded → auto-categorized → journal entry posted → tax estimate updated → deduction tracked
- Receipt image stored with 7-year retention
- At tax time: Schedule C / T2125 auto-populated from ledger data
- Agent verifies every deduction has supporting documentation
- "Your total deductions for 2026: $47,200 across 14 categories. 3 items need documentation."

**US-D.3: Recurring Operations Auto-Pilot**
As a business owner, I want the agent to handle all recurring financial operations without my involvement.

Acceptance criteria:
- Recurring invoices sent on schedule (with pre-send notification)
- Recurring expenses auto-recorded when detected in bank feed
- Quarterly tax installments calculated and reminded
- Monthly financial health report auto-generated and delivered
- Year-end closing checklist managed proactively

---

## Part 3: Architecture Decisions for Beyond-MVP

### AD-B1: Agent Memory Evolution (Short-term → Long-term → Episodic)

**Current:** Pattern memory per vendor (AbPattern table)
**Beyond MVP:** Three-tier memory system:
1. **Working memory** (Redis): current conversation context, in-flight operations
2. **Long-term memory** (PostgreSQL): learned patterns, preferences, financial history
3. **Episodic memory** (Vector DB): natural language recall — "What did I spend on travel last quarter?" → semantic search over transactions

**Why:** QuickBooks search is keyword-only. AgentBook with episodic memory can answer natural language questions about ANY historical data.

### AD-B2: Multi-Agent Orchestration

**Current:** Single orchestrator handles all intents sequentially
**Beyond MVP:** Specialized sub-agents that collaborate:
- **Bookkeeper Agent**: handles expense recording, categorization, reconciliation
- **Tax Strategist Agent**: monitors tax position, suggests optimizations
- **Collections Agent**: manages invoice follow-up, payment predictions
- **Compliance Agent**: ensures all regulatory deadlines are met
- **Insights Agent**: discovers patterns, generates business intelligence

Each sub-agent has its own skill set, memory, and optimization objective. The orchestrator delegates to the right sub-agent based on intent.

**Why:** Specialized agents deliver higher quality than a generalist. The Tax Strategist can maintain deep context about tax law changes, while the Bookkeeper focuses on categorization accuracy.

### AD-B3: Real-Time Event Streaming (Beyond Polling)

**Current:** Vercel cron jobs poll every hour
**Beyond MVP:** WebSocket-based real-time event streaming:
- Bank transaction imported → instant notification (not next cron cycle)
- Payment received → instant celebration + real-time dashboard update
- Cash flow threshold crossed → immediate alert
- Use Ably/Pusher for real-time WebSocket delivery alongside Telegram

**Why:** Real-time feedback creates the feeling of a live financial partner, not a batch processing system.

### AD-B4: Skill Composition (Skills That Use Skills)

**Current:** Skills are independent modules
**Beyond MVP:** Skills that compose other skills:
- "Invoice-to-Cash" skill composes: invoice-creation + payment-follow-up + stripe-payments + reconciliation
- "Year-End Sprint" skill composes: deduction-hunting + tax-forms + year-end-closing + contractor-reporting
- Composition is declared in skill manifest, orchestrated by framework

**Why:** Complex financial workflows (like year-end closing) require multiple skills working in sequence. Composition enables building sophisticated automations from simple, tested building blocks.

### AD-B5: Offline-First Mobile (PWA + Service Worker)

**Current:** Web dashboard + Telegram bot
**Beyond MVP:** Progressive Web App with offline support:
- Receipt photos queued offline, synced when connected
- Dashboard data cached for offline viewing
- GPS mileage tracking via Service Worker (background)
- Push notifications via Web Push API (supplement Telegram)

**Why:** Freelancers are mobile. They need to snap receipts on the go, often without reliable connectivity.

---

## Part 4: Prioritized Roadmap

### Phase 6: Production Hardening (4 weeks)
**Goal:** Ship the MVP to real users.
1. Live Plaid bank connection (production Plaid credentials)
2. Live Stripe Connect for invoice payments
3. Receipt OCR via real LLM vision (Claude/GPT-4V via service-gateway)
4. Production error monitoring (Sentry)
5. Onboarding wizard UI
6. CPA portal UI
7. 10 additional financial reports (AR aging detail, AP summary, expense by vendor, income by client, etc.)

### Phase 7: Time Tracking + Hourly Billing (3 weeks)
**Goal:** Capture the consultant/freelancer market that bills by the hour.
1. Built-in timer (start/stop via Telegram or web)
2. Project-based time tracking
3. Auto-invoice from time entries
4. Profitability per project / per client
5. "You spent 12 hours on Acme this week at $150/hr = $1,800 unbilled"

### Phase 8: Financial Copilot (4 weeks)
**Goal:** Agent becomes a proactive financial advisor.
1. Subscription audit: identify unused/underused SaaS
2. Client concentration risk analysis
3. Seasonal pattern detection + cash reserve recommendations
4. Smart pricing suggestions based on effective hourly rate
5. Multi-year tax planning with scenario modeling

### Phase 9: Mobile PWA + Offline (3 weeks)
**Goal:** Full mobile experience beyond Telegram.
1. PWA with offline receipt capture
2. GPS mileage tracking (background)
3. Push notifications
4. Dashboard with cached data
5. Biometric auth (FaceID/fingerprint)

### Phase 10: Multi-Agent System (6 weeks)
**Goal:** Specialized sub-agents for higher quality.
1. Bookkeeper Agent
2. Tax Strategist Agent
3. Collections Agent
4. Insights Agent
5. Agent-to-agent communication protocol
6. User can configure agent behavior ("be more aggressive on invoice follow-up")

---

## Part 5: Key Metrics to Track

| Metric | Target | Why |
|--------|--------|-----|
| Time to first expense | < 5 minutes | Onboarding friction = churn |
| Receipt-to-expense time | < 10 seconds | Core UX differentiator |
| Auto-categorization accuracy (30 days) | > 95% | Trust builds usage |
| Proactive message action rate | > 40% | Proves agent value |
| Monthly active Telegram sessions | > 20/tenant | Shows daily-use engagement |
| Trial-to-paid conversion | > 15% | Business viability |
| CPA satisfaction score | > 4.5/5 | CPA referrals drive growth |
| Tax savings identified per user/year | > $2,000 | ROI justification for $12/mo |
