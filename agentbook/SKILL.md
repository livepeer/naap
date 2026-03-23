# AgentBooks Development Skill

## Overview

This skill defines the quality standards, patterns, and constraints that MUST be followed when building any component of the AgentBooks agent-based accounting system. Any code generation, architecture decision, or implementation task for AgentBooks must follow these rules.

---

## Core Invariants (Never Violate)

### Accounting Integrity
- Every financial transaction MUST produce a balanced journal entry where sum(debits) == sum(credits). This is checked programmatically, not by LLM.
- The balance check is a hard gate that runs BEFORE committing to the database. If it fails, the transaction is rejected — no exceptions, no overrides.
- Journal entries are immutable once committed. Corrections are made via reversing entries, never by editing existing records.
- Trial balance must sum to zero at all times. If it doesn't, this is a severity-1 incident.

### Agent-Guardrail Separation
- The LLM PROPOSES actions. The constraint engine VALIDATES actions. These are always separate components.
- Never put accounting constraints inside LLM prompts as instructions. Constraints are code, not text.
- The LLM never has direct write access to the ledger. All writes go through the constraint engine.
- If a constraint check fails, the LLM does not get to retry with a "fixed" version. The failure escalates to the human.

### Verification Independence
- The executor and the verifier MUST use different prompts and preferably different model calls.
- The verifier's job is to find errors, not to confirm success. Its prompt must be adversarial.
- Verification includes both programmatic checks (balance, amount range) and LLM reasoning (does this make sense in context).
- A verification failure triggers rollback BEFORE any commit, not a post-commit correction.

### Tenant Isolation
- Every database query MUST include tenant_id as a filter. No exceptions.
- PostgreSQL RLS policies are the last line of defense, not the primary mechanism — application code must also filter.
- LLM prompts MUST contain only the requesting tenant's data. Cross-tenant context contamination is a security incident.
- S3 paths MUST be prefixed with tenant_id. Kafka messages MUST include tenant_id in the key.

---

## Code Patterns

### Plugin Tool Implementation

Every tool in a plugin MUST follow this pattern:

```python
class Tool:
    name: str                    # Unique tool identifier
    description: str             # Used by the agent to understand the tool
    input_schema: dict           # JSON Schema for input validation
    output_schema: dict          # JSON Schema for output validation
    constraints: list[Constraint]  # Hard gates and escalation rules
    compensation: Callable       # Rollback function for saga pattern

    async def execute(self, input: dict, context: TenantContext) -> ToolResult:
        # 1. Validate input against schema
        # 2. Load tenant-specific config
        # 3. Execute the domain logic
        # 4. Validate output against schema
        # 5. Return typed result
        pass

    async def compensate(self, input: dict, output: ToolResult, context: TenantContext):
        # Undo the action (for saga rollback)
        pass
```

### Constraint Definition

Constraints MUST be declarative and deterministic:

```python
class Constraint:
    name: str
    type: Literal['hard_gate', 'escalation', 'soft_check']
    enforcement: Literal['pre_execution', 'pre_commit', 'post_execution']
    
    def evaluate(self, input: dict, context: TenantContext) -> ConstraintResult:
        # Returns: PASS, FAIL (block), or ESCALATE (pause for human)
        # This is deterministic code, never an LLM call
        pass
```

### Context Assembly

Context MUST be typed and scoped:

```python
@dataclass
class ExpenseContext:
    tenant_id: str
    chart_of_accounts: list[Account]        # Always loaded
    vendor_history: list[Transaction]        # Last 20 from this vendor
    category_distribution: dict[str, float]  # This month's spending by category
    learned_patterns: list[Pattern]          # Vendor → category rules
    tax_jurisdiction: TaxJurisdiction        # For deductibility hints
    auto_approve_limit: Decimal              # Tenant's escalation threshold
```

Never pass raw database dumps or unstructured text as context. Every field has a type, a purpose, and a scope (how much data to load).

### Journal Entry Creation

Always follow this sequence:

```
1. Propose entry (LLM or rule-based)
2. Validate balance (programmatic: sum(debits) == sum(credits))
3. Check period status (programmatic: period is open)
4. Check amount threshold (programmatic: compare to auto-approve limit)
5. Run anomaly detection (statistical: compare to historical)
6. IF any check fails → escalate or reject, DO NOT commit
7. IF all checks pass → verification pass (separate LLM call)
8. IF verification passes → commit to ledger + emit event
9. IF verification fails → rollback + escalate
```

Steps 2-5 are the constraint engine. Step 7 is the verifier. They are separate components.

### Escalation Format

All escalations to the user MUST include:

```
1. What the agent wants to do (specific action, not vague)
2. Why it needs approval (which constraint triggered, or low confidence)
3. The agent's recommendation (best guess with confidence)
4. Alternatives (if applicable)
5. Action buttons (approve / reject / modify)
```

Example:
```
📋 Expense needs your review

I want to categorize a $347.00 charge from "AMZN MKTP" as Office Supplies.

I'm only 62% confident — this could also be:
• Software & Subscriptions (25%)
• Inventory / Materials (13%)

The amount is higher than your typical Office Supplies ($45 average).

[✅ Office Supplies] [💻 Software] [📦 Inventory] [✏️ Other]
```

### Event Emission

Every state change MUST emit an event BEFORE the state change is committed:

```python
event = ExecutionEvent(
    event_id=uuid4(),
    tenant_id=context.tenant_id,
    event_type='journal_entry_committed',
    timestamp=utcnow(),
    actor='agent',  # or 'human'
    action={
        'entry_id': 'JE-001',
        'lines': [...],
        'memo': 'Uber ride to client meeting',
    },
    reasoning='Categorized as Travel based on vendor pattern match (confidence: 0.92)',
    constraints_passed=['balance_invariant', 'period_gate', 'amount_threshold'],
    verification_result='passed',
)
await kafka.produce('agentbooks.execution_events', key=context.tenant_id, value=event)
```

---

## LLM Prompt Standards

### Intent Parsing Prompts
- Include 5-8 few-shot examples covering common intents
- Examples must include edge cases (ambiguous amount, missing date, personal vs business)
- Output MUST be a typed JSON object matching the Intent schema
- If the LLM cannot parse with confidence, output `{ "type": "clarification_needed", "question": "..." }`

### Categorization Prompts
- Always include the full chart of accounts in the prompt (it's small enough)
- Include the top 5 most recent transactions for the same vendor
- Include the tenant's learned patterns for this vendor
- Require the LLM to output: category_id, confidence (0-1), reasoning (one sentence), alternatives (top 3)
- Never let the LLM invent new categories — it must pick from the chart of accounts

### Verification Prompts
- Frame as adversarial: "Your job is to find errors in this journal entry."
- Include the original intent, the proposed entry, and the source data
- Ask specific questions: "Does the amount match the receipt? Is the category consistent with this vendor's history? Are debits and credits balanced?"
- Output: pass/fail with specific error description if fail

### Prompt Versioning
- Every prompt template has a version number
- Prompt changes are tracked in git like code changes
- A/B testing: new prompt versions are tested against a labeled dataset before deployment
- Prompt performance metrics: accuracy, latency, token count — tracked per version

---

## Testing Standards

### Unit Tests
- Every constraint must have tests for: pass, fail, and edge cases
- Every tool must have tests for: valid input, invalid input, compensation (rollback)
- Balance invariant test: 100% coverage — every path that creates a journal entry must verify balance

### Integration Tests
- End-to-end: Telegram message → intent parse → categorize → journal entry → event emitted
- Bank reconciliation: synthetic bank feed → matching → exception handling
- Invoice lifecycle: create → send → payment webhook → reconciliation

### Accounting-Specific Tests
- Trial balance after N random transactions: must always sum to zero
- Period close: verify no entries can be posted to closed periods
- Debit/credit rules: expense increases = debit, revenue increases = credit, asset increases = debit, liability increases = credit (verified for every account type)
- Rounding: all financial calculations use Decimal (not float), rounded to 2 decimal places

### Agent Quality Tests
- Categorization accuracy: benchmark against a labeled dataset of 200+ expenses
- Intent parsing accuracy: benchmark against 100+ diverse user messages
- Escalation appropriateness: verify that low-confidence items DO escalate and high-confidence items DON'T

---

## Error Handling

### External Service Failures
- Plaid down: log warning, skip sync, retry in 30 minutes, surface "bank sync delayed" to user
- Stripe down: queue invoice sends, retry with exponential backoff, surface status
- LLM provider down: fail open for reads (user can still query data), fail closed for writes (no categorization without LLM), surface "I'm having trouble thinking right now, I'll process this when I'm back"
- Telegram API down: queue outbound messages, deliver on recovery

### Data Integrity Failures
- Balance check failure: NEVER allow commit. Log severity-1 event. Notify operator.
- Duplicate transaction detection: idempotency key on every tool call. If duplicate detected, return cached result.
- Orphaned journal entries (no matching expense/invoice): detected in daily integrity check, flagged for review.

### Escalation Failures
- User doesn't respond to escalation in 48 hours: re-send with reminder
- User doesn't respond in 7 days: move to "needs attention" queue, surface in weekly digest
- Never auto-resolve an escalation by guessing. If the human doesn't decide, the item stays pending.

---

## Performance Budgets

| Operation | Target | Hard Limit |
|-----------|--------|------------|
| Telegram acknowledgment | 2 seconds | 5 seconds |
| Expense categorization (text) | 5 seconds | 15 seconds |
| Receipt OCR + categorization | 10 seconds | 30 seconds |
| Invoice creation | 8 seconds | 20 seconds |
| Conversational query | 5 seconds | 15 seconds |
| Dashboard page load | 1 second | 3 seconds |
| Bank sync (incremental) | background | within 30 minutes |

### LLM Cost Budget
- Intent parsing: Haiku/mini tier ($0.001 per call)
- Categorization: Haiku/mini tier ($0.002 per call)
- Planning: Sonnet tier ($0.01 per call)
- Verification: Sonnet tier ($0.01 per call)
- Target: < $5/month per active tenant at 100 transactions/month

---

## Documentation Requirements

### Every Tool Must Document
- Purpose (one sentence)
- Input schema with field descriptions
- Output schema with field descriptions
- Constraints that apply to this tool
- Compensation action (how to undo)
- Example input/output pairs (at least 3)

### Every Architecture Decision Must Document
- Decision (what we chose)
- Rationale (why)
- Alternatives considered (what we rejected and why)
- Trade-offs (what we gave up)
- Reversibility (how hard to change this later)

### Every Escalation Type Must Document
- Trigger condition (when it fires)
- User-facing message template
- Available actions (what buttons/options the user sees)
- Timeout behavior (what happens if no response)
- Resolution: what the agent does after user responds
