# AgentBook Telegram Bot — Test Guide

Bot: `@Agentbookdev_bot` | Mapped to Maya's account

## Quick Start
1. Open Telegram, find `@Agentbookdev_bot`
2. Send `/start` — welcome message
3. Send `/help` — see all capabilities
4. Send `/help expenses` — detailed expense commands

---

## Test Script: Expenses (5 min)

```
1. "Spent $45 on lunch at Starbucks"
   → Should record expense, categorize as Meals
   
2. "Paid $99 for GitHub subscription"
   → Should record, categorize as Software & Subscriptions

3. "Show last 5 expenses"
   → Should list recent expenses

4. "How much did I spend on travel?"
   → Should query and answer

5. "Categorize my uncategorized expenses"
   → Should auto-categorize and show results

6. "Show spending breakdown"
   → Should show category breakdown

7. "Any alerts I should know about?"
   → Should check for anomalies

8. "No, that should be Travel"  (after recording an expense)
   → Should re-categorize and learn
```

## Test Script: Invoices (5 min)

```
1. "Invoice Acme $5000 for consulting"
   → Should create draft invoice

2. "Send that invoice"
   → Should mark as sent (email if client has address)

3. "Show my invoices"
   → Should list invoices with status icons

4. "Who owes me money?"
   → Should show AR aging report

5. "Got $5000 from Acme"
   → Should record payment

6. "Show my clients"
   → Should list clients with balances

7. "Start timer for TechCorp project"
   → Should start time tracker

8. "Stop timer"
   → Should stop and show duration

9. "Show unbilled time"
   → Should show hours by client

10. "Send payment reminders"
    → Should send reminders for overdue invoices
```

## Test Script: Tax (5 min)

```
1. "How much tax do I owe?"
   → Should show tax estimate

2. "Show quarterly tax payments"
   → Should show Q1-Q4 status

3. "What deductions can I claim?"
   → Should show deduction suggestions

4. "Start my tax filing for 2025"
   → Should create filing session, show completeness per form

5. "What's missing for my tax filing?"
   → Should show missing fields by form

6. [Send a photo of a T4 slip]
   → Should OCR extract and auto-fill T1 fields

7. "Review T2125"
   → Should show business income form status

8. "Review my GST return"
   → Should show GST/HST status

9. "Validate my tax return"
   → Should run validation rules

10. "Export my tax forms"
    → Should generate export

11. "Submit to CRA"
    → Should e-file (mock in dev)
```

## Test Script: Reports & Finance (3 min)

```
1. "Show profit and loss"
   → P&L with revenue/expense breakdown

2. "Show balance sheet"
   → Assets, liabilities, equity

3. "How long will my cash last?"
   → Cash flow projection (30/60/90 days)

4. "Financial summary"
   → Quick snapshot of cash, revenue, expenses

5. "What money moves should I make?"
   → Proactive suggestions

6. "Check bank reconciliation status"
   → Matched vs unmatched transactions
```

## Test Script: Multi-Step Plans (3 min)

```
1. "Categorize expenses and then show breakdown"
   → Should show plan with 2+ steps, ask to confirm

2. "yes"
   → Should execute steps, show evaluation

3. "undo"
   → Should revert last action

4. "Invoice Acme $3000 and then send it"
   → Should show plan: create + send

5. "cancel"
   → Should cancel the plan
```

## Test Script: Automation & CPA (2 min)

```
1. "Alert me when spending exceeds $500"
   → Should create automation rule

2. "Show my automations"
   → Should list active rules

3. "Add note for CPA: review Q3 expenses"
   → Should create CPA note

4. "Share access with my accountant"
   → Should generate access link
```

## Tips
- Type naturally — the agent uses LLM classification for ambiguous messages
- Corrections like "no, that should be Travel" update the agent's memory
- Send photos of receipts or tax slips — OCR extracts data automatically
- Multi-step requests use "and then" / "then" keywords to trigger planning
- Session commands: yes, no, undo, skip, status
