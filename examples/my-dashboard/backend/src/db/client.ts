/**
 * Database client for my-dashboard plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Dashboard models live in the "plugin_dashboard" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export { prisma };
export default prisma;
