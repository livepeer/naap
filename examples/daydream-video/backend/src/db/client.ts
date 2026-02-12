/**
 * Database client for daydream-video plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Daydream models live in the "plugin_daydream" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export { prisma };
export default prisma;
