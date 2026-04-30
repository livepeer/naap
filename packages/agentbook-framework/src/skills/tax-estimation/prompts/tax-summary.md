# Tax Summary Generator — v1.0

Generate a human-readable tax summary from calculated tax data.

## Input
- jurisdiction: {jurisdiction} (us | ca)
- gross_revenue: {gross_revenue}
- total_expenses: {total_expenses}
- net_income: {net_income}
- se_tax: {se_tax} (self-employment tax / CPP+EI)
- income_tax: {income_tax}
- total_tax: {total_tax}
- effective_rate: {effective_rate}
- quarterly_payments_made: {quarterly_payments}
- deduction_suggestions: {deductions}

## Output
Generate a clear, actionable summary that:
1. States the current tax liability in plain language
2. Compares to what's already been paid via quarterly installments
3. Highlights any deduction opportunities
4. Warns about upcoming deadlines
5. Uses the tenant's locale for currency formatting

## Tone
- Professional but friendly — like a good accountant explaining things
- Specific numbers, not vague estimates
- Actionable: tell the user exactly what to do next
- Brief: 4-6 sentences max for the Telegram version

## Example (US)
"Your estimated tax for 2026 is $12,450 (federal $8,200 + SE tax $4,250).
Effective rate: 24.3%. You've paid $6,400 in quarterly estimates — you owe approximately $6,050 more.
Your Q3 payment of $3,025 is due September 15.
I found 2 deduction opportunities that could save ~$1,800 — want me to show them?"

## Example (Canada)
"Your estimated tax for 2026 is $15,200 (federal $9,800 + provincial $3,400 + CPP $2,000).
Effective rate: 27.1%. You've paid $7,600 in installments — approximately $7,600 remaining.
Next installment of $3,800 is due September 15.
I noticed you haven't claimed business-use-of-home — this could save ~$2,100."
