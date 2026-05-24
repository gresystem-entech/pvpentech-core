-- Migration: add_refund_attempts_and_backoff
-- Adds backoff/retry columns to refund_log and creates refund_attempt table

-- 1. Add new columns to refund_log
ALTER TABLE "refund_log"
  ADD COLUMN IF NOT EXISTS "attemptCount"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxAttempts"       INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAttemptedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastErrorCode"     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "lastErrorMessage"  VARCHAR(500);

-- 2. Add index on nextAttemptAt for batch query performance
CREATE INDEX IF NOT EXISTS "refund_log_nextAttemptAt_idx" ON "refund_log"("nextAttemptAt");

-- 3. Add 'abandoned' to RefundStatus enum
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'abandoned';

-- 4. Create RefundAttemptStatus enum
DO $$ BEGIN
  CREATE TYPE "RefundAttemptStatus" AS ENUM ('processing', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 5. Create refund_attempt table
CREATE TABLE IF NOT EXISTS "refund_attempt" (
  "id"             SERIAL PRIMARY KEY,
  "refundLogId"    INTEGER NOT NULL,
  "attemptNumber"  INTEGER NOT NULL,
  "status"         "RefundAttemptStatus" NOT NULL,
  "idempotencyKey" VARCHAR(100) NOT NULL,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  "pgRefundId"     VARCHAR(200),
  "errorCode"      VARCHAR(50),
  "errorMessage"   VARCHAR(1000),
  "rawResponse"    TEXT,
  CONSTRAINT "refund_attempt_refundLogId_attemptNumber_key" UNIQUE ("refundLogId", "attemptNumber"),
  CONSTRAINT "refund_attempt_refundLogId_fkey" FOREIGN KEY ("refundLogId")
    REFERENCES "refund_log"("id") ON DELETE CASCADE
);

-- 6. Indexes on refund_attempt
CREATE INDEX IF NOT EXISTS "refund_attempt_status_idx" ON "refund_attempt"("status");
CREATE INDEX IF NOT EXISTS "refund_attempt_startedAt_idx" ON "refund_attempt"("startedAt");
