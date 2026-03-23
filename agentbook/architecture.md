# AgentBooks — Architecture Design Document

## 1. Architecture Philosophy

AgentBooks is an agent-based accounting system built on NaaP (Network as a Platform). The fundamental architectural decision is to treat accounting as a domain plugin on a general-purpose agent management platform, not as a standalone application. This means every architectural choice must work for accounting today AND be reusable when NaaP adds CRM, HR, or trading plugins tomorrow.

Three non-negotiable principles:

1. **The agent proposes, the constraint engine disposes.** The LLM generates plans and actions; programmatic guardrails validate and gate execution. These are never the same component.
2. **Context is the product, not the model.** Quality comes from structured context assembly — typed, entity-resolved, temporally-scoped — not from model selection.
3. **Verify independently from execute.** The executor and the verifier are separate reasoning passes with separate prompts.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Interface Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Telegram Bot  │  │ Web Dashboard│  │ Email Ingest      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────────┘  │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                NaaP Control Plane                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Tenant Layer (from Daydream)               │  │
│  │  Identity │ Auth │ Billing Meter │ Per-Tenant Config    │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Agent Orchestrator (new)                   │  │
│  │  Intent Parser → Context Assembler → DAG Planner       │  │
│  │  → Executor → Verifier → Escalation Router             │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │           Plugin Tool Registry (extended)               │  │
│  │  ┌──────────┐ ┌────────┐ ┌──────┐ ┌────────────────┐  │  │
│  │  │Accounting│ │Invoicing│ │ Tax  │ │Bank/Stripe     │  │  │
│  │  │Plugin    │ │Plugin   │ │Plugin│ │Plugin          │  │  │
│  │  └──────────┘ └────────┘ └──────┘ └────────────────┘  │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         ▼                                    │
│  ┌─────────────────────┐  ┌────────────────────────────┐    │
│  │  Quality System      │  │  Event Bus (Kafka)          │    │
│  │  Guardrails          │  │  Execution events           │    │
│  │  Constraint Engine   │  │  Audit trail                │    │
│  │  Verification Pass   │  │  Pattern memory feed        │    │
│  └─────────────────────┘  └────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Data Layer                               │
│  ┌───────────┐  ┌──────────┐  ┌────────┐  ┌─────────────┐  │
│  │PostgreSQL  │  │S3 (docs) │  │Redis   │  │Pattern Store│  │
│  │(ledger)    │  │          │  │(cache) │  │(learned     │  │
│  │            │  │          │  │        │  │ rules)      │  │
│  └───────────┘  └──────────┘  └────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Component Architecture

### 3.1 Interface Layer

**Telegram Bot Service**
- Framework: Grammy (TypeScript) or python-telegram-bot
- Responsibilities: message routing, inline keyboards for approvals, photo/document reception, conversation state management
- Stateless — all conversation context stored in Redis, keyed by tenant_id + chat_id
- Message types handled: text (natural language intent), photo (receipt), document (PDF invoice/statement), callback_query (approval buttons)
- Outbound: proactive alerts (tax reminders, AR aging, anomaly flags)

**Web Dashboard**
- Framework: Next.js with React
- Server-side rendering for reports; client-side for interactive charts (Recharts)
- Auth: same tenant identity as Telegram (link via one-time code)
- Read-only in MVP — all write actions go through Telegram/agent
- Pages: dashboard (cash flow), invoices, expenses, tax estimates, settings

**Email Ingest Service**
- Dedicated ingest email address per tenant (e.g., receipts-{tenant_id}@agentbooks.io)
- Parses attachments (PDF, images) and forwards to OCR pipeline
- Implemented as webhook receiver from email provider (SendGrid Inbound Parse)

### 3.2 Agent Orchestrator

This is the central nervous system. It receives intents from the interface layer and produces validated, audited financial actions.

**Intent Parser**
- Input: raw user message (text, photo, or document) + tenant context
- Output: structured intent object with typed fields
- Implementation: LLM call with few-shot examples specific to accounting domain
- Intent types: `record_expense`, `create_invoice`, `ask_question`, `approve_action`, `configure_setting`, `request_report`
- Each intent type has a typed schema; the parser must produce valid output or escalate

```typescript
type Intent =
  | { type: 'record_expense'; amount: number; vendor?: string; category?: string; date?: string; receipt_url?: string }
  | { type: 'create_invoice'; client: string; amount: number; description: string; terms?: string }
  | { type: 'ask_question'; query: string; time_range?: DateRange }
  | { type: 'approve_action'; action_id: string; decision: 'approve' | 'reject' }
  // ...
```

**Context Assembler**
- The most critical component for quality. Assembles structured context before any reasoning.
- Per-intent context loading:
  - `record_expense`: chart of accounts, vendor history (last 20 transactions from this vendor), category distribution for this month, learned categorization rules, tenant tax jurisdiction
  - `create_invoice`: client record, past invoices to this client, default terms, tenant business info, Stripe connection status
  - `ask_question`: relevant ledger summaries, date-range scoped aggregations, prior Q&A patterns
- Context is typed and schema-validated — never raw text dumps
- Loaded from Redis cache (hot context) with PostgreSQL fallback (cold context)
- Cache warming: tenant context pre-loaded at configurable intervals

**DAG Task Planner**
- Input: parsed intent + assembled context
- Output: directed acyclic graph of typed subtasks
- Each node in the DAG has: tool_name, input_schema, expected_output_schema, compensation_action (rollback)
- Plan is validated before execution:
  - All tool references resolve to registered tools
  - Input/output types chain correctly between nodes
  - No circular dependencies
  - Estimated cost (LLM tokens + API calls) within budget

Example plan for "Invoice Acme Corp $5,000 for March consulting, net-30":
```
1. resolve_client("Acme Corp") → client_record
2. calculate_due_date(terms="net-30") → due_date
3. generate_invoice(client_record, amount=5000, description="March consulting", due_date) → invoice_draft
4. generate_invoice_pdf(invoice_draft) → pdf_url
5. ESCALATE_TO_HUMAN(preview: invoice_draft, pdf_url) → approval
6. IF approved: send_invoice_email(client_record.email, pdf_url) → sent_status
7. IF approved: create_journal_entry(debit=AR, credit=Revenue, amount=5000) → journal_entry
```

**Executor**
- Walks the DAG node by node (respecting dependency ordering)
- For each node: loads the tool from the registry, validates input against schema, calls the tool, validates output against schema
- Between each tool call: runs constraint checks from the Quality System
- On failure: executes compensation actions in reverse order (saga pattern)
- Idempotency: each execution step has a unique idempotency key; retries are safe
- Timeout per tool call: configurable, default 30 seconds

**Verifier**
- Independent reasoning pass AFTER execution completes
- Uses a different prompt template than the executor
- Checks: journal entry balance (programmatic, not LLM), amount reasonableness (within 2σ of category), entity consistency (vendor name matches, dates make sense), cross-reference with bank feed if available
- Verification failure → rollback + escalate to human
- Verification pass → commit to ledger + emit event

**Escalation Router**
- Decision matrix:
  - Confidence < 70% on categorization → ask user with top 3 options
  - Amount > auto-approve threshold → require explicit approval
  - New vendor or category → confirm before creating
  - Tax-impacting action → always surface for awareness
  - Verification failure → explain and ask
- Escalation format: Telegram message with inline keyboard buttons
- Escalation timeout: 48 hours, with reminder at 24 hours
- Unresolved escalations: logged, not auto-resolved

### 3.3 Plugin Tool Registry

Each domain capability is a plugin that registers tools with typed interfaces. Plugins are independently deployable and versionable.

**Plugin Manifest Schema:**
```yaml
plugin:
  name: accounting-core
  version: 1.0.0
  description: Double-entry ledger operations
  
tools:
  - name: create_journal_entry
    description: Create a balanced journal entry
    input:
      lines:
        type: array
        items:
          type: object
          properties:
            account_id: { type: string }
            debit: { type: number, minimum: 0 }
            credit: { type: number, minimum: 0 }
      memo: { type: string }
      date: { type: string, format: date }
      source_document_url: { type: string, optional: true }
    output:
      entry_id: { type: string }
      balance_verified: { type: boolean }
      
  - name: categorize_expense
    description: Categorize an expense against the chart of accounts
    input:
      amount: { type: number }
      vendor: { type: string }
      description: { type: string }
      receipt_data: { type: object, optional: true }
    output:
      category_id: { type: string }
      confidence: { type: number, minimum: 0, maximum: 1 }
      reasoning: { type: string }
      alternatives: { type: array }

constraints:
  - name: balance_invariant
    type: hard_gate
    rule: "For every journal entry: sum(debits) == sum(credits)"
    enforcement: pre_commit
    
  - name: period_gate
    type: hard_gate
    rule: "Cannot post to a closed fiscal period"
    enforcement: pre_execution
    
  - name: amount_threshold
    type: escalation
    rule: "If amount > tenant.auto_approve_limit, escalate"
    enforcement: pre_execution

validators:
  - name: anomaly_detector
    type: soft_check
    rule: "Flag if amount > mean + 2*stddev for this category (trailing 12 months)"
    action: escalate_with_context
```

**MVP Plugins:**

1. **accounting-core**: Journal entries, chart of accounts, trial balance, period management
2. **expense-tracker**: Expense creation, categorization, receipt OCR, recurring detection
3. **invoicing**: Invoice creation, PDF generation, delivery, AR tracking, payment matching
4. **tax-engine**: Tax estimation, quarterly calculations, deduction suggestions, filing prep
5. **bank-connector**: Plaid integration, transaction sync, reconciliation
6. **stripe-connector**: Payment processing, webhook handling, fee tracking, payout matching

### 3.4 Quality System

**Constraint Engine**
- Runs BEFORE each tool call in the execution DAG
- Loads constraints from the plugin manifest for the tool being called
- Hard gates: block execution if violated (balance invariant, period gate)
- Escalation gates: pause execution and surface to human (amount threshold, new vendor)
- Soft checks: log warning but allow execution (anomaly detection)
- Constraint evaluation is deterministic code, not LLM inference

**Verification Pass**
- Runs AFTER all tool calls complete but BEFORE committing to ledger
- Independent re-validation: re-sums all journal entry lines, cross-references with source data
- Pattern comparison: compares outcome against similar past tasks
- Generates audit record: every decision with reasoning
- On failure: full rollback, escalation to human with explanation

**Audit Log**
- Every action: tool call, constraint check, escalation, approval, verification result
- Immutable append-only log (event sourcing)
- Fields: timestamp, tenant_id, action_type, input, output, decision, reasoning, actor (agent or human)
- Retention: 7 years (tax compliance)
- Queryable for compliance audits and debugging

### 3.5 Pattern Memory

- Stores learned categorization rules per tenant
- Structure: vendor_pattern → category_id, confidence, created_by (agent_learned | user_corrected), usage_count
- Updated when: user confirms a categorization, user corrects a categorization, recurring pattern detected
- Queried during: context assembly for expense categorization
- Drift detection: if a pattern's accuracy drops below 85% over trailing 30 uses, flag for review
- Storage: PostgreSQL table with tenant isolation, Redis cache for hot patterns

### 3.6 Event Bus

- Kafka topic: `agentbooks.execution_events`
- Event types: `intent_received`, `plan_created`, `tool_called`, `constraint_checked`, `escalation_sent`, `approval_received`, `verification_passed`, `transaction_committed`
- Consumers:
  - Audit log writer
  - Pattern memory updater
  - Analytics aggregator (for dashboard)
  - Notification service (Telegram alerts)
- Partitioned by tenant_id for ordered processing per tenant

---

## 4. Data Architecture

### 4.1 Ledger Database (PostgreSQL)

```
tenants
  id, name, business_type, fiscal_year_start, tax_jurisdiction, 
  currency, created_at, config_json

accounts (chart of accounts)
  id, tenant_id, code, name, type (asset|liability|equity|revenue|expense),
  parent_id, is_active, tax_category

journal_entries
  id, tenant_id, date, memo, source_type, source_id, 
  created_by (agent|human), verified, created_at

journal_lines
  id, entry_id, account_id, debit, credit, description

vendors
  id, tenant_id, name, normalized_name, default_category_id, 
  transaction_count, last_seen

clients
  id, tenant_id, name, email, address, default_terms

invoices
  id, tenant_id, client_id, number, amount, description, 
  issued_date, due_date, status (draft|sent|viewed|paid|overdue),
  stripe_invoice_id, pdf_url

expenses
  id, tenant_id, amount, vendor_id, category_id, date, 
  description, receipt_url, bank_transaction_id, confidence

bank_transactions
  id, tenant_id, plaid_transaction_id, account_id, amount, 
  date, description, merchant_name, matched_expense_id, 
  matched_invoice_id, status (matched|pending|exception)

patterns (learned categorization rules)
  id, tenant_id, vendor_pattern, category_id, confidence,
  source (agent_learned|user_corrected), usage_count, 
  last_used, accuracy_trailing_30

tax_estimates
  id, tenant_id, period, gross_revenue, total_expenses,
  net_income, estimated_se_tax, estimated_income_tax,
  estimated_total, calculated_at

escalations
  id, tenant_id, action_type, action_data, reasoning,
  status (pending|approved|rejected|expired), 
  created_at, resolved_at, resolved_by
```

### 4.2 Multi-Tenancy

- Row-level isolation via `tenant_id` on every table
- Database-level: PostgreSQL Row Level Security (RLS) policies
- Application-level: tenant_id injected by NaaP control plane, never from client
- Indexes: every query path includes tenant_id as leading column
- Future: per-tenant schema isolation for enterprise customers

---

## 5. Key Architecture Decisions

### AD-1: Telegram-first, not web-first
**Decision:** Telegram bot is the primary interface; web dashboard is read-only and supplementary.
**Rationale:** Self-employed users need frictionless, always-available access. They're already in Telegram/WhatsApp all day. A web app requires them to context-switch. Telegram gives us: photo capture (receipts), inline buttons (approvals), proactive notifications (alerts), and zero onboarding friction. The web dashboard serves the analytical use cases (charts, reports) that don't work well in chat.
**Trade-off:** Limited rich UI for complex interactions. Mitigated by keeping write actions simple (approve/reject, confirm/correct) and sending users to web for reports.

### AD-2: Plugin-per-domain, not monolith
**Decision:** Each accounting capability (ledger, invoicing, tax, banking) is a separate plugin with its own tool definitions, constraints, and validators.
**Rationale:** Enables independent deployment, testing, and versioning. The invoicing plugin can be updated without touching the ledger. New capabilities (payroll, inventory) are new plugins, not code changes to existing modules. This is the NaaP plugin model — same pattern for video pipelines, accounting tools, and future domains.
**Trade-off:** Cross-plugin transactions require coordination. Mitigated by the orchestrator's DAG planner which can span multiple plugins in a single execution plan with saga-pattern rollback.

### AD-3: Hard guardrails as code, not LLM instructions
**Decision:** Accounting invariants (balance check, period gate, amount thresholds) are programmatic constraints, not part of the LLM prompt.
**Rationale:** LLMs can be convinced to ignore instructions. A programmatic gate that checks `sum(debits) == sum(credits)` cannot be circumvented, hallucinated past, or forgotten in a long context window. This is the "agent proposes, constraint engine disposes" principle. The LLM never touches the ledger directly — it proposes journal entries that must pass through the constraint engine before committing.
**Trade-off:** Requires explicit constraint definition for every invariant. Mitigated by the plugin manifest making constraint declaration a first-class part of tool registration.

### AD-4: Event sourcing for audit trail
**Decision:** All state changes are recorded as immutable events in Kafka before being materialized into PostgreSQL.
**Rationale:** Tax compliance requires a complete, tamper-proof audit trail. Event sourcing gives us: reconstructibility (replay events to rebuild state), auditability (every change has a timestamp, actor, and reason), debugging (trace any balance issue to its source event), and pattern memory (events feed the learning pipeline).
**Trade-off:** Increased storage and complexity. Mitigated by Kafka's efficient compression and the fact that we already have Kafka infrastructure from NaaP.

### AD-5: Verify-then-commit, not commit-then-fix
**Decision:** Journal entries are staged, verified independently, then committed. Never committed speculatively.
**Rationale:** Financial records have downstream consequences (tax calculations, reports, bank reconciliation). An incorrect entry that's later corrected is worse than a delayed entry that's right the first time. The verification pass is a separate LLM call with a different prompt ("find errors in this journal entry") plus programmatic checks (balance, amount range, entity consistency).
**Trade-off:** Adds latency (one extra LLM call per transaction). Mitigated by caching verification templates and batching low-risk verifications.

### AD-6: LLM model selection by task tier
**Decision:** Use fast/cheap models (Claude Haiku, GPT-4o-mini) for parsing and categorization; use strong models (Claude Sonnet/Opus, GPT-4o) for planning and verification.
**Rationale:** 80% of agent tasks are classification (intent parsing, expense categorization) where fast models perform adequately. 20% require deep reasoning (tax planning, anomaly explanation, complex invoice interpretation) where model quality matters. This keeps per-tenant LLM costs under $5/month for typical usage.
**Trade-off:** Model routing adds complexity. Mitigated by defining model tier per tool in the plugin manifest.

---

## 6. Security Architecture

### Authentication and Authorization
- Telegram: bot token + chat_id mapped to tenant_id during onboarding
- Web dashboard: magic link auth sent via Telegram (no passwords)
- API: JWT tokens with tenant_id claim, issued by NaaP identity service
- All inter-service communication: mTLS within the cluster

### Data Protection
- PostgreSQL: encryption at rest (AES-256), TLS in transit
- S3: server-side encryption, per-tenant key prefix
- Redis: TLS, no persistence of sensitive data (cache only)
- Plaid tokens: stored in AWS Secrets Manager / HashiCorp Vault, never in application database
- Stripe keys: same secret manager, accessed via environment injection

### Tenant Isolation
- Database: PostgreSQL RLS policies enforce tenant_id on every query
- Kafka: tenant_id in message key ensures ordered processing; ACLs prevent cross-tenant access
- S3: bucket policy with tenant_id prefix isolation
- LLM calls: tenant context assembled server-side; no cross-tenant data leakage in prompts

---

## 7. Architecture Review Checklist

Before considering this architecture complete, verify each item:

### Correctness
- [ ] Every financial action produces a balanced journal entry (debits = credits)
- [ ] Constraint engine runs BEFORE every tool call, not after
- [ ] Verification pass is a SEPARATE reasoning pass from execution
- [ ] Escalation decisions are based on deterministic rules, not LLM judgment
- [ ] Audit log captures every state change with actor, timestamp, and reasoning

### Completeness
- [ ] All 8 epics from requirements.md have corresponding architectural components
- [ ] Error paths defined for: tool failure, LLM failure, bank API failure, Stripe webhook failure
- [ ] Rollback (compensation) actions defined for every tool in every plugin
- [ ] Tenant lifecycle: creation, configuration, data export, deletion
- [ ] Rate limiting: per-tenant LLM call budget, API call limits

### Consistency
- [ ] Tenant_id is the leading column in every database index
- [ ] Event schema is consistent across all event types (standard envelope)
- [ ] Plugin manifest schema is the same for all plugins (no special cases)
- [ ] Escalation format is identical regardless of trigger source

### Security
- [ ] No bank credentials stored in application database
- [ ] No Stripe keys in application code or config files
- [ ] Tenant data isolation verified at database, storage, and event bus layers
- [ ] LLM prompts contain only the requesting tenant's data

### Operability
- [ ] Health checks defined for every service
- [ ] Alerting rules: ledger imbalance, escalation timeout, bank sync failure
- [ ] Backup and restore procedure documented
- [ ] Graceful degradation: system functions (with reduced capability) when LLM provider is down

### NaaP Alignment
- [ ] Plugin registration follows NaaP plugin framework conventions
- [ ] Tenant identity uses NaaP/Daydream identity service
- [ ] Billing meter integrates with NaaP MVNO billing model
- [ ] Event bus uses existing NaaP Kafka infrastructure
- [ ] Agent orchestrator registers as a NaaP control plane service
