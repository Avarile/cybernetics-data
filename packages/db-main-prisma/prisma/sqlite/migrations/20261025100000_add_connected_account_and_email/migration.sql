-- CreateTable
CREATE TABLE "connected_account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "secret" TEXT,
    "metadata" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_time" DATETIME,
    "connected_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME
);

-- CreateTable
CREATE TABLE "email_source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "field_map" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "last_synced_time" DATETIME,
    "last_error" TEXT,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME
);

-- CreateTable
CREATE TABLE "email_sync_cursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "folder_name" TEXT NOT NULL,
    "cursor" TEXT,
    "backfill" TEXT,
    "last_synced_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME
);

-- CreateTable
CREATE TABLE "email_message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "internet_message_id" TEXT,
    "thread_id" TEXT,
    "record_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'imported',
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME
);

-- CreateIndex
CREATE INDEX "connected_account_user_id_idx" ON "connected_account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "connected_account_user_id_provider_address_key" ON "connected_account"("user_id", "provider", "address");

-- CreateIndex
CREATE UNIQUE INDEX "email_source_table_id_key" ON "email_source"("table_id");

-- CreateIndex
CREATE INDEX "email_source_base_id_idx" ON "email_source"("base_id");

-- CreateIndex
CREATE INDEX "email_source_integration_id_idx" ON "email_source"("integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_sync_cursor_source_id_folder_id_key" ON "email_sync_cursor"("source_id", "folder_id");

-- CreateIndex
CREATE INDEX "email_message_source_id_internet_message_id_idx" ON "email_message"("source_id", "internet_message_id");

-- CreateIndex
CREATE INDEX "email_message_record_id_idx" ON "email_message"("record_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_message_source_id_provider_message_id_key" ON "email_message"("source_id", "provider_message_id");

