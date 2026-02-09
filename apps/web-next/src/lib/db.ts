/**
 * Database client for the Next.js shell (web-next).
 *
 * Uses the unified @naap/database package (single DB, multi-schema).
 * The Next.js app accesses the "public" schema for core platform models.
 */

import { prisma, PrismaClient } from '@naap/database';

/**
 * Helper to handle Prisma connection in serverless environment.
 * Ensures connection is established before query.
 */
export async function withDb<T>(fn: (db: typeof prisma) => Promise<T>): Promise<T> {
  try {
    await prisma.$connect();
    return await fn(prisma);
  } finally {
    // In serverless, disconnect after each request
    if (process.env.VERCEL) {
      await prisma.$disconnect();
    }
  }
}

export { prisma, PrismaClient };
export default prisma;
