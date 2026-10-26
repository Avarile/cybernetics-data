-- CreateTable
CREATE TABLE "agent_installation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "space_id" TEXT,
    "base_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'needs_setup',
    "pack_version" INTEGER NOT NULL DEFAULT 0,
    "seeded_version" INTEGER NOT NULL DEFAULT 0,
    "table_map" TEXT NOT NULL DEFAULT '{}',
    "field_map" TEXT NOT NULL DEFAULT '{}',
    "health" TEXT,
    "last_verified_time" DATETIME,
    "last_error" TEXT,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME
);

-- CreateTable
CREATE TABLE "agent_secret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "credential_record_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "last_used_time" DATETIME
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_record_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT,
    "pending_approval" TEXT,
    "usage" TEXT,
    "error" TEXT,
    "started_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_time" DATETIME
);

-- CreateTable
CREATE TABLE "agent_audit_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "result_summary" TEXT,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_secret_credential_record_id_key" ON "agent_secret"("credential_record_id");
CREATE INDEX "agent_run_thread_record_id_idx" ON "agent_run"("thread_record_id");
CREATE INDEX "agent_run_actor_user_id_idx" ON "agent_run"("actor_user_id");
CREATE INDEX "agent_audit_log_run_id_idx" ON "agent_audit_log"("run_id");
CREATE INDEX "agent_audit_log_created_time_idx" ON "agent_audit_log"("created_time");
