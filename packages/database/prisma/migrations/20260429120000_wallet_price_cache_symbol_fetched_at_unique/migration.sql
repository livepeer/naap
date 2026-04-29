-- Deduplicate (symbol, fetchedAt) before adding uniqueness
DELETE FROM "plugin_wallet"."WalletPriceCache" t
WHERE t."id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (PARTITION BY "symbol", "fetchedAt" ORDER BY "id") AS rn
    FROM "plugin_wallet"."WalletPriceCache"
  ) sub
  WHERE rn > 1
);

-- Replace non-unique composite index with unique index
DROP INDEX IF EXISTS "plugin_wallet"."WalletPriceCache_symbol_fetchedAt_idx";

CREATE UNIQUE INDEX "WalletPriceCache_symbol_fetchedAt_key" ON "plugin_wallet"."WalletPriceCache" ("symbol", "fetchedAt");
