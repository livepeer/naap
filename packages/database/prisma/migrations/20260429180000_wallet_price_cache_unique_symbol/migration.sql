-- One row per symbol (latest quote wins for upsert-by-symbol).
DELETE FROM "plugin_wallet"."WalletPriceCache" t
WHERE t."id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (PARTITION BY "symbol" ORDER BY "fetchedAt" DESC, "id" DESC) AS rn
    FROM "plugin_wallet"."WalletPriceCache"
  ) sub
  WHERE rn > 1
);

DROP INDEX IF EXISTS "plugin_wallet"."WalletPriceCache_symbol_fetchedAt_key";

CREATE UNIQUE INDEX "WalletPriceCache_symbol_key" ON "plugin_wallet"."WalletPriceCache" ("symbol");

CREATE INDEX "WalletPriceCache_symbol_fetchedAt_idx" ON "plugin_wallet"."WalletPriceCache" ("symbol", "fetchedAt");
