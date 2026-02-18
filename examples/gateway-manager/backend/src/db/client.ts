/**
 * Database client for gateway-manager plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Gateway models live in the "plugin_gateway" PostgreSQL schema.
 */

import { prisma } from '@naap/database';
import type { PrismaClient } from '@naap/database';

export const db: PrismaClient = prisma;

export default db;
