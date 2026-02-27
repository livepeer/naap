-- ============================================================
-- NAAP Unified Database — Schema Initialization
-- ============================================================
-- Creates all PostgreSQL schemas used by the platform.
-- This script runs automatically on first container start
-- via docker-entrypoint-initdb.d/.
--
-- Architecture: Single database "naap", multiple schemas:
--   public           — Core platform (users, auth, plugins, marketplace, RBAC)
--   plugin_community — Community hub (posts, comments, reputation, badges)
--   plugin_wallet    — My Wallet (connections, transactions, staking)
--   plugin_dashboard — My Dashboard (Metabase dashboards, preferences)
--   plugin_daydream  — Daydream Video (AI video sessions, settings)
--   plugin_gateway   — Gateway Manager (gateways, connections, metrics)
--   plugin_capacity  — Capacity Planner (requests, soft commits)
--   plugin_developer_api — Developer API (AI models, offers, API keys, usage)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS plugin_community;
CREATE SCHEMA IF NOT EXISTS plugin_wallet;
CREATE SCHEMA IF NOT EXISTS plugin_dashboard;
CREATE SCHEMA IF NOT EXISTS plugin_daydream;
CREATE SCHEMA IF NOT EXISTS plugin_gateway;
CREATE SCHEMA IF NOT EXISTS plugin_capacity;
CREATE SCHEMA IF NOT EXISTS plugin_developer_api;
CREATE SCHEMA IF NOT EXISTS plugin_service_gateway;
