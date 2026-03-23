/**
 * Database client for agentbook-invoice plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Invoice models live in the "plugin_agentbook_invoice" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export const db = prisma;

export default db;
