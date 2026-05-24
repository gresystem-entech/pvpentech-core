-- AlterTable: add rebateRate to charging_site (skip if already exists)
ALTER TABLE "charging_site" ADD COLUMN IF NOT EXISTS "rebateRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable: add status to fault_log (skip if already exists)
ALTER TABLE "fault_log" ADD COLUMN IF NOT EXISTS "status" "FaultStatus" NOT NULL DEFAULT 'Received';

-- CreateIndex (skip if already exists)
CREATE INDEX IF NOT EXISTS "fault_log_status_idx" ON "fault_log"("status");
