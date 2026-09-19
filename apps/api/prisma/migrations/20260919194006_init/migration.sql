-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'EXPIRED', 'DESTROYED', 'FAILED');

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PROVISIONING',
    "database_name" TEXT NOT NULL,
    "role_password" TEXT NOT NULL,
    "client_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_events" (
    "session_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("session_id","seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_database_name_key" ON "sessions"("database_name");

-- CreateIndex
CREATE INDEX "sessions_status_last_active_at_idx" ON "sessions"("status", "last_active_at");

-- CreateIndex
CREATE INDEX "sessions_client_hash_status_idx" ON "sessions"("client_hash", "status");

-- CreateIndex
CREATE INDEX "session_events_session_id_type_seq_idx" ON "session_events"("session_id", "type", "seq");

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
