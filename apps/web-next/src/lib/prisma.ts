/**
 * Re-export prisma client from db.ts
 * This file provides a consistent import path for API routes
 */
export { prisma, withDb } from './db';
export { prisma as default } from './db';
