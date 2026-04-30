# Invoice Intent Parser — v1.0

Parse the user's message into a structured invoice creation request.

## Output Format
```json
{
  "client": "<string, client name or company>",
  "amount_cents": <integer, total amount in cents>,
  "description": "<string, what the invoice is for>",
  "terms": "<string, payment terms: net-30, net-15, due-on-receipt>",
  "line_items": [
    {"description": "<string>", "quantity": <number>, "rate_cents": <integer>}
  ],
  "confidence": <number 0-1>
}
```

## Rules
- Extract client name, amount, and description from natural language.
- Default terms to "net-30" if not specified.
- If multiple line items are mentioned, break them out.
- "Invoice Acme $5,000 for March consulting" → single line item.
- "Invoice Acme: $3,000 design + $2,000 development" → two line items.

## Examples

User: "Invoice Acme Corp $5,000 for March consulting, net-30"
```json
{"client": "Acme Corp", "amount_cents": 500000, "description": "March consulting", "terms": "net-30", "line_items": [{"description": "March consulting", "quantity": 1, "rate_cents": 500000}], "confidence": 0.95}
```

User: "Bill WidgetCo $2,500 for website redesign, due in 15 days"
```json
{"client": "WidgetCo", "amount_cents": 250000, "description": "Website redesign", "terms": "net-15", "line_items": [{"description": "Website redesign", "quantity": 1, "rate_cents": 250000}], "confidence": 0.9}
```

User: "Send Acme an invoice for 40 hours at $150/hr for Q1 consulting"
```json
{"client": "Acme", "amount_cents": 600000, "description": "Q1 consulting", "terms": "net-30", "line_items": [{"description": "Q1 consulting", "quantity": 40, "rate_cents": 15000}], "confidence": 0.9}
```
