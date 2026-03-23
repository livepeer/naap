/**
 * Core types for the AgentBook framework.
 * These types are framework-level — skills and plugins depend on them.
 */

// === Intent Types ===

export type Intent =
  | { type: 'record_expense'; amount_cents?: number; vendor?: string; category?: string; date?: string; receipt_url?: string; is_personal?: boolean }
  | { type: 'categorize_expense'; expense_id: string; category_id?: string }
  | { type: 'create_invoice'; client: string; amount_cents: number; description: string; terms?: string; line_items?: InvoiceLineItem[] }
  | { type: 'send_invoice'; invoice_id: string }
  | { type: 'record_payment'; invoice_id?: string; amount_cents: number; method?: string; date?: string }
  | { type: 'ask_question'; query: string; time_range?: DateRange }
  | { type: 'request_report'; report_type: ReportType; time_range?: DateRange }
  | { type: 'estimate_tax' }
  | { type: 'approve_action'; action_id: string; decision: 'approve' | 'reject' | 'modify'; modification?: Record<string, unknown> }
  | { type: 'configure_setting'; key: string; value: unknown }
  | { type: 'clarification_needed'; question: string; original_input: string };

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  rate_cents: number;
  amount_cents: number;
}

export interface DateRange {
  start: string; // ISO date
  end: string;   // ISO date
}

export type ReportType = 'pnl' | 'balance_sheet' | 'cash_flow' | 'trial_balance' | 'tax_estimate' | 'aging_report';

// === Tool Types ===

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  idempotency_key: string;
}

// === DAG Plan ===

export interface DAGNode {
  id: string;
  tool_name: string;
  skill_name: string;
  input: Record<string, unknown>;
  expected_output_schema?: Record<string, unknown>;
  compensation_action?: string;
  depends_on: string[]; // IDs of nodes that must complete first
  model_tier: 'haiku' | 'sonnet' | 'opus';
}

export interface DAGPlan {
  id: string;
  tenant_id: string;
  intent: Intent;
  nodes: DAGNode[];
  estimated_cost_tokens: number;
  created_at: string;
}

// === Tenant Types ===

export interface TenantConfig {
  tenant_id: string;
  business_type: string;
  jurisdiction: string;     // 'us' | 'ca' | ...
  region: string;           // state/province code
  currency: string;         // 'USD' | 'CAD' | ...
  locale: string;           // 'en-US' | 'en-CA' | 'fr-CA' | ...
  timezone: string;         // 'America/New_York' | 'America/Toronto' | ...
  fiscal_year_start: number; // month (1-12)
  auto_approve_limit_cents: number;
}

// === LLM Gateway Types ===

export interface LLMRequest {
  tier: 'haiku' | 'sonnet' | 'opus';
  tenant_id: string;
  prompt: string;
  system_prompt?: string;
  max_tokens: number;
  temperature?: number;
  response_format?: 'text' | 'json';
}

export interface LLMResponse {
  content: string;
  model: string;
  tokens_used: { input: number; output: number };
  cost_cents: number;
}
