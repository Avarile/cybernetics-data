-- CreateTable
CREATE TABLE "agent_search" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "thread_record_id" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "steps" TEXT NOT NULL DEFAULT '[]',
    "lens" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3),

    CONSTRAINT "agent_search_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_search_thread_record_id_idx" ON "agent_search"("thread_record_id");

-- CreateIndex
CREATE INDEX "agent_search_run_id_idx" ON "agent_search"("run_id");
