import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

// G-009: Verify that line tables (journal lines, expense splits, invoice lines)
// carry a tenantId field with a dedicated index. This is a schema-level
// regression test — we assert against the Prisma schema text rather than the
// DB so it runs offline. DB-integration coverage lives in the cross-tenant
// lookup suite.

// Resolve repo root from this test file: tests/e2e/gtm/security/<file> -> 4 levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

test('line tables carry tenantId field and @@index([tenantId]) (G-009)', async () => {
  const schema = await fs.readFile(
    path.join(REPO_ROOT, 'packages/database/prisma/schema.prisma'),
    'utf8',
  );

  const models = ['AbJournalLine', 'AbExpenseSplit', 'AbInvoiceLine'];
  for (const m of models) {
    const fieldRe = new RegExp(`model ${m}\\s*\\{[^}]*tenantId\\s+String`, 's');
    expect(schema, `${m} missing tenantId field`).toMatch(fieldRe);
    const indexRe = new RegExp(`model ${m}\\s*\\{[^}]*@@index\\(\\[tenantId\\]\\)`, 's');
    expect(schema, `${m} missing @@index([tenantId])`).toMatch(indexRe);
  }
});

test('migration backfills tenantId from parent before SET NOT NULL (G-009)', async () => {
  const migrationsDir = path.join(REPO_ROOT, 'packages/database/prisma/migrations');
  const entries = await fs.readdir(migrationsDir);
  const target = entries.find((d) => d.endsWith('_add_tenantid_to_lines'));
  expect(target, 'add_tenantid_to_lines migration directory must exist').toBeTruthy();
  const sql = await fs.readFile(path.join(migrationsDir, target!, 'migration.sql'), 'utf8');

  // Each line table: ADD COLUMN nullable -> UPDATE backfill -> SET NOT NULL.
  const tables: Array<{ schema: string; table: string; parent: string; fk: string }> = [
    { schema: 'plugin_agentbook_core',    table: 'AbJournalLine',  parent: 'AbJournalEntry', fk: 'entryId' },
    { schema: 'plugin_agentbook_expense', table: 'AbExpenseSplit', parent: 'AbExpense',      fk: 'expenseId' },
    { schema: 'plugin_agentbook_invoice', table: 'AbInvoiceLine',  parent: 'AbInvoice',      fk: 'invoiceId' },
  ];
  for (const t of tables) {
    // ADD COLUMN must be nullable (no inline NOT NULL).
    const addRe = new RegExp(
      `ALTER TABLE "${t.schema}"\\."${t.table}" ADD COLUMN "tenantId" TEXT(?! NOT NULL)`,
    );
    expect(sql, `${t.table} ADD COLUMN must be nullable`).toMatch(addRe);
    // UPDATE backfill must reference the parent table + FK.
    const updRe = new RegExp(
      `UPDATE "${t.schema}"\\."${t.table}"[^;]*FROM "${t.schema}"\\."${t.parent}"[^;]*${t.fk}`,
      's',
    );
    expect(sql, `${t.table} missing UPDATE backfill from ${t.parent}`).toMatch(updRe);
    // ALTER COLUMN SET NOT NULL must come after backfill (assert ordering).
    const altIdx = sql.search(
      new RegExp(`ALTER TABLE "${t.schema}"\\."${t.table}"\\s+ALTER COLUMN "tenantId" SET NOT NULL`),
    );
    const updIdx = sql.search(new RegExp(`UPDATE "${t.schema}"\\."${t.table}"`));
    expect(altIdx, `${t.table} missing SET NOT NULL`).toBeGreaterThan(-1);
    expect(updIdx, `${t.table} missing UPDATE`).toBeGreaterThan(-1);
    expect(
      altIdx,
      `${t.table} SET NOT NULL must come after UPDATE backfill`,
    ).toBeGreaterThan(updIdx);
  }
});
