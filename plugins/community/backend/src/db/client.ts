/**
 * Database client for community plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Community models live in the "plugin_community" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export const db = prisma;

export default db;
