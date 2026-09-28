-- CreateEnum
CREATE TYPE "LabRunStatus" AS ENUM ('PENDING', 'PROVISIONING', 'READY', 'ACTIVE');

-- CreateTable
CREATE TABLE "lab_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "lab_id" TEXT NOT NULL,
    "sandbox_id" TEXT,
    "status" "LabRunStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_runs_session_id_key" ON "lab_runs"("session_id");

-- CreateIndex
CREATE INDEX "lab_runs_status_updated_at_idx" ON "lab_runs"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "lab_runs" ADD CONSTRAINT "lab_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
