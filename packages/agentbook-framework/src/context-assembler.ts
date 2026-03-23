/**
 * Context Assembler — The most critical component for quality.
 *
 * Assembles structured, typed context before any reasoning.
 * Per-intent context loading ensures the LLM gets exactly the right data.
 * Context is never raw text dumps — every field has a type and scope.
 */

import type { Intent, TenantConfig } from './types.js';

export { TenantContext } from './skill-registry.js';

export interface ContextField {
  name: string;
  loader: (tenantId: string, params?: Record<string, unknown>) => Promise<unknown>;
  cache_ttl_seconds?: number;
}

export interface AssembledContext {
  tenant: TenantConfig;
  intent: Intent;
  data: Record<string, unknown>;
  assembled_at: string;
}

/**
 * Context assembly configuration per intent type.
 * Defines what data to load for each type of user request.
 */
const INTENT_CONTEXT_MAP: Record<string, string[]> = {
  record_expense: ['chart_of_accounts', 'vendor_history', 'category_distribution', 'learned_patterns', 'tax_jurisdiction'],
  categorize_expense: ['chart_of_accounts', 'vendor_history', 'learned_patterns'],
  create_invoice: ['client_record', 'past_invoices', 'default_terms', 'business_info', 'stripe_status'],
  send_invoice: ['invoice_details', 'client_record'],
  record_payment: ['invoice_details', 'client_record', 'payment_methods'],
  ask_question: ['ledger_summary', 'date_scoped_aggregations'],
  request_report: ['ledger_summary', 'date_scoped_aggregations', 'tax_config'],
  estimate_tax: ['ledger_summary', 'tax_config', 'quarterly_payments', 'deduction_rules'],
  approve_action: ['pending_escalation'],
};

export class ContextAssembler {
  private loaders: Map<string, ContextField> = new Map();

  /**
   * Register a context field loader.
   * Skills register their context loaders during initialization.
   */
  registerLoader(field: ContextField): void {
    this.loaders.set(field.name, field);
  }

  /**
   * Assemble context for a given intent and tenant.
   */
  async assemble(intent: Intent, tenant: TenantConfig): Promise<AssembledContext> {
    const fieldNames = INTENT_CONTEXT_MAP[intent.type] || [];
    const data: Record<string, unknown> = {};

    // Load all context fields in parallel
    const loadPromises = fieldNames.map(async (name) => {
      const loader = this.loaders.get(name);
      if (loader) {
        try {
          data[name] = await loader.loader(tenant.tenant_id, intent as Record<string, unknown>);
        } catch (err) {
          console.error(`Context loader "${name}" failed:`, err);
          data[name] = null;
        }
      }
    });

    await Promise.all(loadPromises);

    return {
      tenant,
      intent,
      data,
      assembled_at: new Date().toISOString(),
    };
  }
}
