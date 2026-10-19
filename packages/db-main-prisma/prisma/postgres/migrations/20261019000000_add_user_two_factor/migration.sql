-- AlterTable
ALTER TABLE "users" ADD COLUMN "two_factor_email_enabled" BOOLEAN,
ADD COLUMN "two_factor_enabled_time" TIMESTAMP(3);
