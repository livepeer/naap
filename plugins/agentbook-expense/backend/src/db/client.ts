/**
 * Database client for agentbook-expense plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Expense models live in the "plugin_agentbook_expense" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export const db = prisma;

export default db;
