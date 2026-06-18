-- CreateTable: ProviderUsageRecord — cross-provider BPP ⑥ usage telemetry (NAAP-2).
-- Expand-only, additive.
CREATE TABLE "public"."ProviderUsageRecord" (
    "id" TEXT NOT NULL,
    "providerSlug" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "appId" TEXT,
    "windowFrom" TIMESTAMP(3) NOT NULL,
    "windowTo" TIMESTAMP(3) NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "tickets" INTEGER NOT NULL DEFAULT 0,
    "feeWei" TEXT,
    "networkFeeUsdMicros" TEXT,
    "byCapability" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderUsageRecord_providerSlug_windowTo_idx" ON "public"."ProviderUsageRecord"("providerSlug", "windowTo");
CREATE INDEX "ProviderUsageRecord_accountId_windowTo_idx" ON "public"."ProviderUsageRecord"("accountId", "windowTo");
CREATE INDEX "ProviderUsageRecord_appId_windowTo_idx" ON "public"."ProviderUsageRecord"("appId", "windowTo");
