-- AlterTable
ALTER TABLE "public"."PluginPackage" ADD COLUMN "previewTesterUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
