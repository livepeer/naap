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
