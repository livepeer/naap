/**
 * Database client for agentbook-tax plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * AgentBook Tax models live in the "plugin_agentbook_tax" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export const db = prisma;

export default db;
