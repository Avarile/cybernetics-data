-- AlterTable
ALTER TABLE "users" ADD COLUMN "two_factor_email_enabled" BOOLEAN;
ALTER TABLE "users" ADD COLUMN "two_factor_enabled_time" DATETIME;
