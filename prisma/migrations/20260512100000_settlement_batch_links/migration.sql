-- Migration: settlement_batch_links
-- Phase 1: Prisma Schema 변경 + backfill
-- Adds settlement snapshot columns to Transaction,
-- adds transfer result / snapshot key columns to Settlement,
-- adds failed status to SettlementStatus,
-- adds manual period to SettlementPeriod,
-- and backfills existing paid/pending/deferred transactions.

-- ─── 1. Enum 확장 ───────────────────────────────────────────────────────────

-- SettlementStatus에 'failed' 추가
ALTER TYPE "SettlementStatus" ADD VALUE IF NOT EXISTS 'failed';

-- SettlementPeriod에 'manual' 추가
ALTER TYPE "SettlementPeriod" ADD VALUE IF NOT EXISTS 'manual';

-- ─── 2. Transaction 테이블 컬럼 추가 ─────────────────────────────────────────

ALTER TABLE "transaction"
  ADD COLUMN IF NOT EXISTS "settlementId"        INTEGER,
  ADD COLUMN IF NOT EXISTS "settlementSchedule"  "SettlementSchedule",
  ADD COLUMN IF NOT EXISTS "settlementDay"        SMALLINT,
  ADD COLUMN IF NOT EXISTS "settlementDayOfWeek"  SMALLINT;

-- ─── 3. Settlement 테이블 컬럼 추가 ──────────────────────────────────────────

ALTER TABLE "settlement"
  ADD COLUMN IF NOT EXISTS "transferRef"          VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "transferAttemptedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failureReason"         VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "settlementDay"         SMALLINT,
  ADD COLUMN IF NOT EXISTS "settlementDayOfWeek"   SMALLINT;

-- ─── 4. FK 제약 추가 ─────────────────────────────────────────────────────────

ALTER TABLE "transaction"
  ADD CONSTRAINT "transaction_settlementId_fkey"
  FOREIGN KEY ("settlementId")
  REFERENCES "settlement"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- ─── 5. 인덱스 추가 ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "transaction_settlementId_idx"
  ON "transaction"("settlementId");

CREATE INDEX IF NOT EXISTS "transaction_paymentStatus_settlementId_idx"
  ON "transaction"("paymentStatus", "settlementId");

CREATE INDEX IF NOT EXISTS "settlement_partnerId_periodEnd_periodType_settlementDay_set_idx"
  ON "settlement"("partnerId", "periodEnd", "periodType", "settlementDay", "settlementDayOfWeek");

-- ─── 6. Backfill: 기존 Transaction에 정산 snapshot 채우기 ────────────────────
-- station → charging_site → partner_profile 경로로 partner 현재 설정을 snapshot에 복사.
-- 대상: paymentStatus IN ('paid','pending','deferred') AND marginRate IS NULL
-- (refunded/failed/cancelled 행은 정산 대상 아님)
-- 마이그레이션 이전 거래의 정확한 과거 설정 복원은 불가능하므로 현재 partner 설정을 차선으로 채움.

UPDATE "transaction" t
SET
  "marginRate"          = p."marginRate",
  "settlementSchedule"  = p."settlementSchedule",
  "settlementDay"       = p."settlementDay",
  "settlementDayOfWeek" = p."settlementDayOfWeek"
FROM "charging_station" s
JOIN "charging_site"    cs ON cs.id = s."siteId"
JOIN "partner_profile"  p  ON p.id  = cs."partnerId"
WHERE s.id = t."stationId"
  AND t."paymentStatus" IN ('paid', 'pending', 'deferred')
  AND t."marginRate" IS NULL;
