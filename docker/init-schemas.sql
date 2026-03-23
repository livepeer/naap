-- ============================================================
-- A3P Unified Database — Schema Initialization
-- ============================================================
-- Creates all PostgreSQL schemas used by the platform.
-- This script runs automatically on first container start
-- via docker-entrypoint-initdb.d/.
--
-- Architecture: Single database "a3p", multiple schemas:
--   public                 — Core platform (users, auth, plugins, marketplace, RBAC)
--   plugin_community       — Community hub (posts, comments, reputation, badges)
--   plugin_service_gateway — Service Gateway (API connectors, keys, usage)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS plugin_community;
CREATE SCHEMA IF NOT EXISTS plugin_service_gateway;
