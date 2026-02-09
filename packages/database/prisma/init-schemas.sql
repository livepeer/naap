-- Initialize PostgreSQL schemas for NaaP unified database
-- Run this before prisma db push

-- Create schemas if they don't exist
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS plugin_community;
CREATE SCHEMA IF NOT EXISTS plugin_wallet;
CREATE SCHEMA IF NOT EXISTS plugin_dashboard;
CREATE SCHEMA IF NOT EXISTS plugin_daydream;
CREATE SCHEMA IF NOT EXISTS plugin_gateway;

-- Grant usage to the database user (adjust username as needed)
GRANT USAGE ON SCHEMA plugin_community TO CURRENT_USER;
GRANT USAGE ON SCHEMA plugin_wallet TO CURRENT_USER;
GRANT USAGE ON SCHEMA plugin_dashboard TO CURRENT_USER;
GRANT USAGE ON SCHEMA plugin_daydream TO CURRENT_USER;
GRANT USAGE ON SCHEMA plugin_gateway TO CURRENT_USER;

-- Grant create on schemas for migrations
GRANT CREATE ON SCHEMA plugin_community TO CURRENT_USER;
GRANT CREATE ON SCHEMA plugin_wallet TO CURRENT_USER;
GRANT CREATE ON SCHEMA plugin_dashboard TO CURRENT_USER;
GRANT CREATE ON SCHEMA plugin_daydream TO CURRENT_USER;
GRANT CREATE ON SCHEMA plugin_gateway TO CURRENT_USER;
