-- Migration: payment_refund_batch
-- 2026-04-16

-- 1. PaymentStatus enum 추가 (skip if already exists)
DO $$ BEGIN CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'refunded'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. RefundStatus enum 추가 (skip if already exists)
DO $$ BEGIN CREATE TYPE "RefundStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. ChargerConfigStatus enum 추가 (skip if already exists)
DO $$ BEGIN CREATE TYPE "ChargerConfigStatus" AS ENUM ('normal', 'error'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4. SettlementSchedule enum 추가 (skip if already exists)
DO $$ BEGIN CREATE TYPE "SettlementSchedule" AS ENUM ('daily', 'weekly', 'monthly'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5. Transaction 테이블에 결제 필드 추가
ALTER TABLE "transaction"
  ADD COLUMN IF NOT EXISTS "paymentStatus"   "PaymentStatus",
  ADD COLUMN IF NOT EXISTS "paymentMethod"   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "pgTransactionId" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "unitPriceKrw"    INTEGER,
  ADD COLUMN IF NOT EXISTS "marginRate"      DECIMAL(5, 2);

-- 6. FaultLog에 reportedAt 인덱스 추가
CREATE INDEX IF NOT EXISTS "fault_log_reportedAt_idx" ON "fault_log"("reportedAt");

-- 7. PartnerProfile에 정산 스케줄 필드 추가
ALTER TABLE "partner_profile"
  ADD COLUMN IF NOT EXISTS "settlementSchedule"  "SettlementSchedule" NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS "settlementDayOfWeek" SMALLINT;

-- 8. RefundLog 테이블 생성
CREATE TABLE IF NOT EXISTS "refund_log" (
  "id"            SERIAL PRIMARY KEY,
  "transactionId" INTEGER        NOT NULL UNIQUE,
  "userId"        INTEGER,
  "paidAmount"    INTEGER        NOT NULL,
  "chargedAmount" INTEGER        NOT NULL,
  "refundAmount"  INTEGER        NOT NULL,
  "status"        "RefundStatus" NOT NULL DEFAULT 'pending',
  "requestedAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"   TIMESTAMP(3),
  "pgRefundId"    VARCHAR(200),
  "note"          VARCHAR(500),

  CONSTRAINT "refund_log_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "refund_log_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "refund_log_userId_idx"      ON "refund_log"("userId");
CREATE INDEX IF NOT EXISTS "refund_log_status_idx"      ON "refund_log"("status");
CREATE INDEX IF NOT EXISTS "refund_log_requestedAt_idx" ON "refund_log"("requestedAt");

-- 9. ChargerConfig 테이블 생성
CREATE TABLE IF NOT EXISTS "charger_config" (
  "id"        SERIAL PRIMARY KEY,
  "stationId" VARCHAR(50)           NOT NULL,
  "key"       VARCHAR(100)          NOT NULL,
  "value"     TEXT,
  "status"    "ChargerConfigStatus" NOT NULL DEFAULT 'normal',
  "errorDesc" VARCHAR(255),
  "createdAt" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "charger_config_stationId_idx"         ON "charger_config"("stationId");
CREATE UNIQUE INDEX IF NOT EXISTS "charger_config_stationId_key_key" ON "charger_config"("stationId", "key");
