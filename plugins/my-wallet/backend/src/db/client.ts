/**
 * Database client for my-wallet plugin
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * Wallet models live in the "plugin_wallet" PostgreSQL schema.
 */

import { prisma } from '@naap/database';

export { prisma };
export default prisma;
