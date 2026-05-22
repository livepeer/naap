-- AlterTable: Add suspension fields to User
ALTER TABLE "public"."User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "public"."User" ADD COLUMN "suspendedReason" TEXT;
