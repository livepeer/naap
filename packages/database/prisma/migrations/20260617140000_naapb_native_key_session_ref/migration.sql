-- NAAP-B: encrypted provider-session ref for native `naap_` keys.
-- Expand-only / additive: nullable columns only; existing keys leave them null
-- and behave exactly as before. With the `native_keys` flag OFF nothing writes
-- or reads these columns. No destructive change.

ALTER TABLE "plugin_developer_api"."DevApiKey" ADD COLUMN IF NOT EXISTS "providerSessionRefEnc" TEXT;
ALTER TABLE "plugin_developer_api"."DevApiKey" ADD COLUMN IF NOT EXISTS "providerSessionRefIv" TEXT;
