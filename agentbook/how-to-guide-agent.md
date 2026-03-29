# AgentBook — How Your AI Agents Work

## You Have 4 AI Agents Working For You

When you sign up for AgentBook, you get a team of 4 specialized AI agents — like hiring a full accounting department, but they work 24/7 and learn your business.

### 🗂️ Bookkeeper Agent
**What it does:** Records every expense, categorizes transactions, reconciles your bank feed, and manages receipts.

**How it works:**
- Send a receipt photo via Telegram → Bookkeeper reads it, extracts the amount/vendor/date, and categorizes it
- Type "Spent $45 on lunch" → Bookkeeper records it instantly
- Connect your bank → Bookkeeper auto-matches bank transactions to your recorded expenses
- It remembers: "Subway is always Meals. Amazon under $50 is Office Supplies. Amazon over $500 is Equipment."

**It gets smarter over time:**
- First week: asks you to confirm most categorizations
- After 30 days: auto-categorizes 95%+ correctly
- If it makes a mistake and you correct it, it never makes the same mistake again

### 📊 Tax Strategist Agent
**What it does:** Monitors your tax position, hunts for deductions, manages quarterly payments, and generates tax forms.

**How it works:**
- Shows your real-time tax estimate at any time (Telegram: "What's my tax situation?")
- Proactively: "You haven't logged home office expenses this year. Work from home? Save ~$2,100."
- Before quarterly deadlines: "Installment due in 7 days. I calculated $3,200. [Pay now]"
- At year-end: "4 actions could save $2,840. [View optimization report]"

**Jurisdiction-aware:**
- 🇺🇸 US: Schedule C, SE tax (15.3%), IRS quarterly estimates, Section 179
- 🇨🇦 Canada: T2125, CPP/EI, CRA installments, RRSP optimization, GST/HST
- 🇬🇧 UK: Self Assessment, NI Class 2+4, VAT, Payments on Account
- 🇦🇺 Australia: BAS, Medicare levy, PAYG, Super guarantee

### 💰 Collections Agent
**What it does:** Makes sure you get paid on time without you sending awkward reminder emails.

**How it works:**
- Creates invoices from natural language: "Invoice Acme $5,000 for March consulting"
- Tracks time: start/stop timer via Telegram or web
- Auto-generates invoices from unbilled time entries
- Sends payment reminders on your schedule (gentle → firm → urgent)
- Predicts when clients will pay: "Acme typically pays in 18 days"

**Learns per client:**
- "Acme responds to the second reminder within 3 days"
- "WidgetCo pays faster when invoice includes detailed line items"

### 🔍 Insights Agent
**What it does:** Discovers patterns in your financial data that you can't see.

**How it works:**
- Weekly review: "Revenue up 15%, top spend: Software ($420)"
- Subscription audit: "You're paying for 3 services you haven't used since January. Save $1,524/year."
- Client concentration: "73% of revenue is from Acme. Diversify?"
- Seasonal patterns: "Revenue peaks in March and September. Set aside $4,200 from Q1 for Q2."
- What-if scenarios: "If you prepay $3,000 in expenses, you save $660 in taxes."

---

## How To Configure Your Agents

### Navigate to /agentbook/agents

Each agent has 4 settings:

| Setting | What It Controls |
|---------|-----------------|
| **Approach** (slider) | Gentle ← → Assertive. Controls how aggressively the agent acts (e.g., Collections reminder tone) |
| **Auto-approve** (toggle) | ON: agent acts without asking. OFF: agent asks before every action. |
| **Notifications** (dropdown) | Real-time / Daily digest / Weekly summary |
| **AI Model** (dropdown) | Fast (cheapest) / Standard / Premium (most capable) |

### Recommended Settings by Style

**"I want full control":**
- All agents: Auto-approve OFF, Notifications: Real-time
- Every action requires your approval via Telegram button tap

**"Handle it for me":**
- Bookkeeper: Auto-approve ON (it learns fast)
- Tax Strategist: Auto-approve OFF (tax decisions matter)
- Collections: Auto-approve ON, Approach: Assertive
- Insights: Auto-approve ON (read-only, safe)

**"I'm busy, just tell me what's important":**
- All agents: Auto-approve ON, Notifications: Daily digest
- Only critical alerts (tax deadlines, cash flow warnings) come through immediately

---

## How Skills Work

Each agent has **skills** — specific capabilities loaded based on your setup.

### Skill Layers (automatic, no action needed)

1. **Base skills** — Always loaded (expense recording, receipt OCR, invoicing, etc.)
2. **Jurisdiction skills** — Loaded based on your country
   - Canada: T2125 filing, CRA installments, GST/HST tracking, RRSP optimization
   - US: Schedule C, IRS quarterly, 1099-NEC, Section 179
3. **Industry skills** — Loaded when you set your industry
   - Consultant: hourly billing, scope-creep detection, effective rate analysis
   - Agency: project profitability, contractor management
   - E-commerce: inventory COGS, marketplace fees, multi-state sales tax
4. **Marketplace skills** — You install from the skill marketplace
5. **Personalized skills** — Agent creates from learning your patterns

### Installing New Skills

Navigate to the skill marketplace (/agentbook/admin) → Browse available skills → Click "Install" → The relevant agent auto-loads it.

Example: Install "crypto-accounting" → Bookkeeper auto-loads crypto transaction categorization, Tax Strategist loads crypto capital gains calculation.

---

## How The Agent Learns

### What It Learns From

| Signal | What Happens |
|--------|-------------|
| You **confirm** a categorization | Pattern confidence increases by 5% |
| You **correct** a categorization | Old pattern confidence drops, new pattern set at 95% |
| You **ignore** a notification | That notification type's frequency decreases |
| You **act on** a notification | That type's priority increases |
| You **snooze** a reminder | Agent reschedules (respects your timing preference) |
| You **dismiss** permanently | Agent never sends that type again |

### Weekly Self-Assessment

Every week, each agent evaluates its own performance:

- **Bookkeeper:** "My categorization accuracy was 92% this week (3 corrections out of 38). Maintaining current approach."
- **Collections:** "Average days to payment increased to 28. Increasing reminder frequency."
- **Tax Strategist:** "Found 2 new deduction opportunities totaling $1,400. Delivering via Telegram."

If accuracy drops below 85%, the agent automatically switches to "confirmation mode" (asks before acting) until accuracy recovers.

---

## Proactive Notifications (What The Agent Sends You)

Your agents send you messages via Telegram (or web dashboard) — you never need to open AgentBook to stay on top of your finances.

| Time | What You Get |
|------|-------------|
| **8 AM daily** | Daily pulse: "Today: $340 in, $127 out. Balance: $12,450. 1 item needs attention." |
| **Monday AM** | Weekly review: "Revenue $4,200, expenses $1,340. Top spend: Software. Tax rate: 28.3%." |
| **When payment arrives** | "Acme paid $5,000! Net: $4,854.50." 🎉 |
| **7 days before tax deadline** | "Quarterly installment due in 7 days. Amount: $3,200. [Pay now]" |
| **When invoice overdue** | "Acme is 7 days overdue on $5,000. [Send reminder] [Wait] [Skip]" |
| **When cash gets tight** | "Cash drops to $1,200 on April 3. Follow up on Acme invoice?" |
| **November** | "Year-end optimization: 4 actions could save $2,840. [View report]" |

Every message has **one-tap action buttons** — you never need to type a response.

---

## Getting Started

1. **Login** at your AgentBook URL
2. **Complete onboarding** (/agentbook/onboarding) — 7 steps, < 10 minutes
3. **Connect Telegram** — scan QR code or search @AgentBookBot → /start
4. **Snap your first receipt** — send a photo in Telegram
5. **That's it** — the agents take over from here

Your agents will start learning immediately. After 30 days, they'll know your business as well as a dedicated bookkeeper.

---

© 2026 AgentBook. All rights reserved.
