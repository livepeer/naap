-- ============================================================================
-- LEAST-PRIVILEGE NEON ROLES — Phase 9
-- ============================================================================
-- Run in Neon SQL Editor as neondb_owner (or equivalent superuser).
--
-- Prerequisites:
--   - Phase 0 complete (neondb_owner password rotated)
--   - App is still running on neondb_owner (this script creates new roles)
--
-- After running:
--   1. Test on a Neon dev branch with full e2e suite
--   2. Only then update Vercel Production env vars
-- ============================================================================

-- 1. Create the app runtime role
CREATE ROLE naap_app WITH LOGIN PASSWORD '<REPLACE_WITH_GENERATED_PASSWORD>';

-- 2. Create the migration role
CREATE ROLE naap_migrator WITH LOGIN PASSWORD '<REPLACE_WITH_GENERATED_PASSWORD>';

-- 3. Grant CONNECT on the database
GRANT CONNECT ON DATABASE neondb TO naap_app;
GRANT CONNECT ON DATABASE neondb TO naap_migrator;

-- 4. Grant USAGE on all schemas used by the app
GRANT USAGE ON SCHEMA public TO naap_app;
GRANT USAGE ON SCHEMA public TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_community TO naap_app;
GRANT USAGE ON SCHEMA plugin_community TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_wallet TO naap_app;
GRANT USAGE ON SCHEMA plugin_wallet TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_dashboard TO naap_app;
GRANT USAGE ON SCHEMA plugin_dashboard TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_daydream TO naap_app;
GRANT USAGE ON SCHEMA plugin_daydream TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_gateway TO naap_app;
GRANT USAGE ON SCHEMA plugin_gateway TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_capacity TO naap_app;
GRANT USAGE ON SCHEMA plugin_capacity TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_developer_api TO naap_app;
GRANT USAGE ON SCHEMA plugin_developer_api TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_service_gateway TO naap_app;
GRANT USAGE ON SCHEMA plugin_service_gateway TO naap_migrator;
GRANT USAGE ON SCHEMA plugin_orchestrator_leaderboard TO naap_app;
GRANT USAGE ON SCHEMA plugin_orchestrator_leaderboard TO naap_migrator;

-- 5. Grant DML on all existing tables/sequences to naap_app
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_community TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_community TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_wallet TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_wallet TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_dashboard TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_dashboard TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_daydream TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_daydream TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_gateway TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_gateway TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_capacity TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_capacity TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_developer_api TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_developer_api TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_service_gateway TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_service_gateway TO naap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_orchestrator_leaderboard TO naap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plugin_orchestrator_leaderboard TO naap_app;

-- 6. Set default privileges so future tables are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_community GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_community GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_wallet GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_wallet GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_dashboard GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_dashboard GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_daydream GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_daydream GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_gateway GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_gateway GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_capacity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_capacity GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_developer_api GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_developer_api GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_service_gateway GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_service_gateway GRANT USAGE, SELECT ON SEQUENCES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_orchestrator_leaderboard GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO naap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_orchestrator_leaderboard GRANT USAGE, SELECT ON SEQUENCES TO naap_app;

-- 7. Grant migrator full DDL privileges
GRANT ALL PRIVILEGES ON SCHEMA public TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_community TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_community TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_community TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_wallet TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_wallet TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_wallet TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_dashboard TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_dashboard TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_dashboard TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_daydream TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_daydream TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_daydream TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_gateway TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_gateway TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_gateway TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_capacity TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_capacity TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_capacity TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_developer_api TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_developer_api TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_developer_api TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_service_gateway TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_service_gateway TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_service_gateway TO naap_migrator;
GRANT ALL PRIVILEGES ON SCHEMA plugin_orchestrator_leaderboard TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_orchestrator_leaderboard TO naap_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_orchestrator_leaderboard TO naap_migrator;

-- 8. Allow migrator to create new schemas for plugins (least-privilege)
GRANT CREATE ON DATABASE neondb TO naap_migrator;
