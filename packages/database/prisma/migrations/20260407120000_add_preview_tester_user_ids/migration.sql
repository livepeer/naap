-- AlterTable
ALTER TABLE "public"."PluginPackage"
ADD COLUMN "previewTesterUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
