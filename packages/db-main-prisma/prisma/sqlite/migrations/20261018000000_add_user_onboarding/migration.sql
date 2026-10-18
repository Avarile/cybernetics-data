-- AlterTable
ALTER TABLE "users" ADD COLUMN "onboarding_status" TEXT;
ALTER TABLE "users" ADD COLUMN "onboarding_time" DATETIME;

-- Users who predate first-run onboarding never see it.
UPDATE "users" SET "onboarding_status" = 'legacy';
