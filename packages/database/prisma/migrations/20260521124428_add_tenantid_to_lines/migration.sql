-- Migration: Add tenantId to line tables (G-009)
--
-- AbJournalLine, AbExpenseSplit, and AbInvoiceLine previously had no tenantId
-- field, making direct queries on them unfilterable by tenant without joining
-- the parent. This denormalizes tenantId onto the line tables for safe direct
-- queries and tenant-scoped indexes.
--
-- Pattern per table (zero-downtime safe — works on hot tables):
--   1. ADD COLUMN nullable
--   2. UPDATE backfill from parent
--   3. ALTER COLUMN ... SET NOT NULL
--   4. CREATE INDEX

-- ============================================================
-- AbJournalLine (parent: AbJournalEntry via entryId)
-- ============================================================
ALTER TABLE "plugin_agentbook_core"."AbJournalLine" ADD COLUMN "tenantId" TEXT;

UPDATE "plugin_agentbook_core"."AbJournalLine" l
  SET "tenantId" = e."tenantId"
  FROM "plugin_agentbook_core"."AbJournalEntry" e
  WHERE l."entryId" = e."id";

ALTER TABLE "plugin_agentbook_core"."AbJournalLine"
  ALTER COLUMN "tenantId" SET NOT NULL;

CREATE INDEX "AbJournalLine_tenantId_idx"
  ON "plugin_agentbook_core"."AbJournalLine"("tenantId");

-- ============================================================
-- AbExpenseSplit (parent: AbExpense via expenseId)
-- ============================================================
ALTER TABLE "plugin_agentbook_expense"."AbExpenseSplit" ADD COLUMN "tenantId" TEXT;

UPDATE "plugin_agentbook_expense"."AbExpenseSplit" s
  SET "tenantId" = e."tenantId"
  FROM "plugin_agentbook_expense"."AbExpense" e
  WHERE s."expenseId" = e."id";

ALTER TABLE "plugin_agentbook_expense"."AbExpenseSplit"
  ALTER COLUMN "tenantId" SET NOT NULL;

CREATE INDEX "AbExpenseSplit_tenantId_idx"
  ON "plugin_agentbook_expense"."AbExpenseSplit"("tenantId");

-- ============================================================
-- AbInvoiceLine (parent: AbInvoice via invoiceId)
-- ============================================================
ALTER TABLE "plugin_agentbook_invoice"."AbInvoiceLine" ADD COLUMN "tenantId" TEXT;

UPDATE "plugin_agentbook_invoice"."AbInvoiceLine" l
  SET "tenantId" = i."tenantId"
  FROM "plugin_agentbook_invoice"."AbInvoice" i
  WHERE l."invoiceId" = i."id";

ALTER TABLE "plugin_agentbook_invoice"."AbInvoiceLine"
  ALTER COLUMN "tenantId" SET NOT NULL;

CREATE INDEX "AbInvoiceLine_tenantId_idx"
  ON "plugin_agentbook_invoice"."AbInvoiceLine"("tenantId");
