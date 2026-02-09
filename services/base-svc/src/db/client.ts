/**
 * Database client for base-svc
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Core platform models live in the "public" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export const db = prisma;

export default db;
