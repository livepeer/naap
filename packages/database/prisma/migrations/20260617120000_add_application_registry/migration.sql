-- CreateTable: Application registry (NAAP-D). Expand-only, additive.
CREATE TABLE "public"."Application" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'app',
    "teamId" TEXT,
    "ownerUserId" TEXT,
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_slug_key" ON "public"."Application"("slug");
CREATE INDEX "Application_teamId_idx" ON "public"."Application"("teamId");
CREATE INDEX "Application_ownerUserId_idx" ON "public"."Application"("ownerUserId");
CREATE INDEX "Application_slug_idx" ON "public"."Application"("slug");
