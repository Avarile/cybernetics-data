-- AlterTable
ALTER TABLE "users" ADD COLUMN "onboarding_status" TEXT,
ADD COLUMN "onboarding_time" TIMESTAMP(3);

-- Users who predate first-run onboarding never see it.
UPDATE "users" SET "onboarding_status" = 'legacy';
