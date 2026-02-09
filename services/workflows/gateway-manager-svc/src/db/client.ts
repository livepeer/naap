/**
 * Database client for gateway-manager-svc (workflow service)
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Gateway models live in the "plugin_gateway" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export const db = prisma;

export default db;
