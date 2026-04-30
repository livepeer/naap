-- ============================================================
-- A3P Unified Database — Schema Initialization
-- ============================================================
-- Creates all PostgreSQL schemas used by the platform.
-- This script runs automatically on first container start
-- via docker-entrypoint-initdb.d/.
--
-- Architecture: Single database "a3p", multiple schemas:
--   public                 — Core platform (users, auth, plugins, marketplace, RBAC)
--   plugin_community         — Community hub (posts, comments, reputation, badges)
--   plugin_service_gateway   — Service Gateway (API connectors, keys, usage)
--   plugin_agentbook_core    — AgentBook: ledger, chart of accounts, events, calendar
--   plugin_agentbook_expense — AgentBook: expenses, vendors, patterns, recurring rules
--   plugin_agentbook_invoice — AgentBook: invoices, clients, payments, estimates
--   plugin_agentbook_tax     — AgentBook: tax estimates, quarterly payments, deductions
-- ============================================================

CREATE SCHEMA IF NOT EXISTS plugin_community;
CREATE SCHEMA IF NOT EXISTS plugin_service_gateway;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_core;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_expense;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_invoice;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_tax;

-- ============================================================
-- Row Level Security Policies (defense-in-depth)
-- Application code ALSO filters by tenant_id on every query.
-- RLS is the database-layer safety net.
-- ============================================================

-- Note: RLS requires the app to SET the current tenant context.
-- This is done via: SET app.current_tenant_id = '<tenant_id>';
-- before each request's queries.

-- For development, RLS is documented but not enforced.
-- Enable in production by uncommenting the ALTER TABLE lines below.

-- Example policy pattern (apply to all agentbook tables):
-- ALTER TABLE plugin_agentbook_core."AbJournalEntry" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON plugin_agentbook_core."AbJournalEntry"
--   USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- Production RLS will be enabled in Phase 2 after connection pooling
-- compatibility with SET commands is verified on Neon/PgBouncer.
