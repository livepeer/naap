import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '../src/generated/client/index.js';

const prisma = new PrismaClient();

describe('billing schema smoke', () => {
  const testAccountId = `test-${Date.now()}`;
  let planId: string;

  beforeAll(async () => {
    const plan = await prisma.billPlan.create({
      data: {
        code: `test-plan-${Date.now()}`,
        name: 'Test',
        priceCents: 0,
        features: { telegram_bot: false, tax_package_generation: false, multi_user_teams: false },
        quotas: { expenses_created: 10, ocr_scans: 1, ai_messages: 10, invoices_sent: 1, bank_connections: 0 },
      },
    });
    planId = plan.id;
  });

  afterAll(async () => {
    await prisma.billEvent.deleteMany({ where: { accountId: testAccountId } });
    await prisma.billUsageCounter.deleteMany({ where: { accountId: testAccountId } });
    await prisma.billSubscription.deleteMany({ where: { accountId: testAccountId } });
    await prisma.billPlan.delete({ where: { id: planId } });
    await prisma.$disconnect();
  });

  it('creates a subscription pointing at a plan', async () => {
    const sub = await prisma.billSubscription.create({
      data: { accountId: testAccountId, planId, status: 'active' },
    });
    expect(sub.accountId).toBe(testAccountId);
    expect(sub.cancelAtPeriodEnd).toBe(false);
  });

  it('enforces unique accountId on BillSubscription', async () => {
    await expect(
      prisma.billSubscription.create({
        data: { accountId: testAccountId, planId, status: 'active' },
      }),
    ).rejects.toThrow();
  });

  it('upserts BillUsageCounter on (accountId, dimension, periodStart)', async () => {
    const periodStart = new Date('2026-05-01');
    await prisma.billUsageCounter.upsert({
      where: { accountId_dimension_periodStart: { accountId: testAccountId, dimension: 'ocr_scans', periodStart } },
      create: { accountId: testAccountId, dimension: 'ocr_scans', periodStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    await prisma.billUsageCounter.upsert({
      where: { accountId_dimension_periodStart: { accountId: testAccountId, dimension: 'ocr_scans', periodStart } },
      create: { accountId: testAccountId, dimension: 'ocr_scans', periodStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    const row = await prisma.billUsageCounter.findUnique({
      where: { accountId_dimension_periodStart: { accountId: testAccountId, dimension: 'ocr_scans', periodStart } },
    });
    expect(row?.count).toBe(2);
  });

  it('enforces unique stripeEventId on BillEvent', async () => {
    const eid = `evt_test_${Date.now()}`;
    await prisma.billEvent.create({
      data: { accountId: testAccountId, stripeEventId: eid, eventType: 'customer.subscription.updated', payload: {} },
    });
    await expect(
      prisma.billEvent.create({
        data: { accountId: testAccountId, stripeEventId: eid, eventType: 'customer.subscription.updated', payload: {} },
      }),
    ).rejects.toThrow();
  });
});
