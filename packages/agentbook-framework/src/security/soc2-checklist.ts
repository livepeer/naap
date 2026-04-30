/**
 * SOC 2 Compliance Checklist — Type II Readiness
 * Per requirements-v2 NFR-1: "SOC 2 Type II readiness by Phase 5"
 */

export interface ComplianceCheck {
  id: string;
  category: 'security' | 'availability' | 'confidentiality' | 'privacy' | 'processing_integrity';
  title: string;
  description: string;
  status: 'implemented' | 'partial' | 'planned';
  evidence: string;
}

export const SOC2_CHECKLIST: ComplianceCheck[] = [
  // SECURITY
  { id: 'sec-1', category: 'security', title: 'Data encryption at rest', description: 'All data encrypted via PostgreSQL TDE / Neon encryption', status: 'implemented', evidence: 'Neon Postgres encrypts at rest by default (AES-256)' },
  { id: 'sec-2', category: 'security', title: 'Data encryption in transit', description: 'All connections use TLS 1.3', status: 'implemented', evidence: 'Vercel enforces HTTPS, Neon requires SSL connections' },
  { id: 'sec-3', category: 'security', title: 'Authentication', description: 'JWT-based auth with session management', status: 'implemented', evidence: 'NextAuth with NEXTAUTH_SECRET, session cookies' },
  { id: 'sec-4', category: 'security', title: 'RBAC', description: 'Role-based access control (owner/bookkeeper/viewer/cpa)', status: 'implemented', evidence: 'AbTenantAccess model with permission checks' },
  { id: 'sec-5', category: 'security', title: 'Tenant isolation', description: 'Row-level data isolation by tenant_id', status: 'implemented', evidence: 'All queries filter by tenantId, RLS policies documented' },
  { id: 'sec-6', category: 'security', title: 'Secrets management', description: 'API keys and tokens in environment variables, never in code', status: 'implemented', evidence: 'Vercel env vars, no secrets in git' },
  { id: 'sec-7', category: 'security', title: 'Webhook verification', description: 'Telegram + Stripe webhooks verified with secrets', status: 'implemented', evidence: 'TELEGRAM_WEBHOOK_SECRET, Stripe signature verification' },
  { id: 'sec-8', category: 'security', title: 'Input validation', description: 'All API inputs validated before processing', status: 'implemented', evidence: 'Balance invariant, schema validation, constraint engine' },

  // AVAILABILITY
  { id: 'avl-1', category: 'availability', title: 'Health checks', description: 'All services have /healthz endpoints', status: 'implemented', evidence: '4 plugin backends + web-next all have health checks' },
  { id: 'avl-2', category: 'availability', title: 'Graceful degradation', description: 'LLM provider down → non-LLM operations continue', status: 'implemented', evidence: 'Verifier falls back to programmatic checks only' },
  { id: 'avl-3', category: 'availability', title: 'Database backups', description: 'Automated daily backups with point-in-time recovery', status: 'implemented', evidence: 'Neon provides PITR up to 30 days' },
  { id: 'avl-4', category: 'availability', title: 'Horizontal scaling', description: 'Stateless services scale via Vercel Functions', status: 'implemented', evidence: 'All API routes are serverless, no shared state' },

  // CONFIDENTIALITY
  { id: 'cnf-1', category: 'confidentiality', title: 'No financial amounts in LLM prompts', description: 'Sensitive data minimized in external API calls', status: 'partial', evidence: 'Architecture supports it; categorization prompts include amounts for accuracy' },
  { id: 'cnf-2', category: 'confidentiality', title: 'PCI-DSS compliance', description: 'No credit card data stored; Stripe handles payments', status: 'implemented', evidence: 'Stripe Connect handles all payment processing' },

  // PRIVACY
  { id: 'prv-1', category: 'privacy', title: 'Data ownership', description: 'Users own all data, can export and delete', status: 'implemented', evidence: 'data-export skill provides CSV/JSON export for all data' },
  { id: 'prv-2', category: 'privacy', title: 'Data retention', description: '7-year retention for tax compliance', status: 'planned', evidence: 'Architecture supports it; auto-archival not yet implemented' },

  // PROCESSING INTEGRITY
  { id: 'pin-1', category: 'processing_integrity', title: 'Double-entry balance', description: 'Every transaction produces balanced journal entry', status: 'implemented', evidence: 'balance_invariant constraint + database CHECK' },
  { id: 'pin-2', category: 'processing_integrity', title: 'Immutable audit trail', description: 'Journal entries cannot be modified or deleted', status: 'implemented', evidence: 'PUT/PATCH/DELETE return 403 with immutability_invariant' },
  { id: 'pin-3', category: 'processing_integrity', title: 'Idempotent operations', description: 'Webhook handlers prevent duplicate processing', status: 'implemented', evidence: 'stripeEventId unique, plaidTransactionId unique' },
  { id: 'pin-4', category: 'processing_integrity', title: 'Independent verification', description: 'Separate verification pass after execution', status: 'implemented', evidence: 'verifier.ts with adversarial prompt, separate from orchestrator' },
];

export function getComplianceScore(): { total: number; implemented: number; partial: number; planned: number; percentage: number } {
  const total = SOC2_CHECKLIST.length;
  const implemented = SOC2_CHECKLIST.filter(c => c.status === 'implemented').length;
  const partial = SOC2_CHECKLIST.filter(c => c.status === 'partial').length;
  const planned = SOC2_CHECKLIST.filter(c => c.status === 'planned').length;
  return { total, implemented, partial, planned, percentage: Math.round((implemented / total) * 100) };
}
