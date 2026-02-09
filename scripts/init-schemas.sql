-- NAAP Platform - Schema Initialization Script
-- Creates all required schemas for the unified database architecture
-- This script runs automatically when the unified DB container starts

-- Create schemas for each service/plugin
CREATE SCHEMA IF NOT EXISTS core;        -- base-svc tables
CREATE SCHEMA IF NOT EXISTS gateway;     -- gateway-manager plugin
CREATE SCHEMA IF NOT EXISTS wallet;      -- my-wallet plugin
CREATE SCHEMA IF NOT EXISTS community;   -- community plugin
CREATE SCHEMA IF NOT EXISTS dashboard;   -- my-dashboard plugin
CREATE SCHEMA IF NOT EXISTS daydream;    -- daydream-video plugin
CREATE SCHEMA IF NOT EXISTS marketplace; -- marketplace (future)

-- Grant permissions to naap user on all schemas
GRANT ALL ON SCHEMA core TO naap;
GRANT ALL ON SCHEMA gateway TO naap;
GRANT ALL ON SCHEMA wallet TO naap;
GRANT ALL ON SCHEMA community TO naap;
GRANT ALL ON SCHEMA dashboard TO naap;
GRANT ALL ON SCHEMA daydream TO naap;
GRANT ALL ON SCHEMA marketplace TO naap;

-- Set default search path
ALTER DATABASE naap SET search_path TO core, public;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'NAAP schemas initialized successfully';
END $$;
