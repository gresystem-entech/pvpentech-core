-- Phase 3-B: Transaction 모델 정리 + ChargeSessionProjection 신규 생성
-- 생성일: 2026-05-25
-- 설계 참조: outputs/2026-05-21_system_split_design_review.md 섹션 5-1, 5-2
-- 보고서: outputs/2026-05-24_phase3b_transaction_split_projection_report.md
--
-- ⚠️ 운영 적용 시 반드시 다음 순서를 지킬 것:
--   1. 데이터 백업
--   2. 새 테이블 생성 (CREATE TABLE)
--   3. 데이터 백필 (INSERT INTO ... SELECT FROM ...)
--   4. 데이터 검증 (count, sample)
--   5. 기존 컬럼/FK 제거 (ALTER TABLE DROP COLUMN / DROP CONSTRAINT)
--   6. 인덱스/제약 확인
--
-- 옵션 C 결정: settlementSchedule, settlementDay, settlementDayOfWeek는
-- Core Transaction에 유지 (Outbox payload 무결성). paymentStatus, settlementId만 제거.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: PaymentStatus enum을 core → portal schema로 이동
-- (기존 DB가 public schema에 있었다면 RENAME + SET SCHEMA 순서로 처리)
-- ─────────────────────────────────────────────────────────────────────────────

-- NOTE: portal schema에 PaymentStatus enum이 없으면 신규 생성.
-- 기존 public."PaymentStatus"가 있다면 SET SCHEMA로 이동:
-- ALTER TYPE public."PaymentStatus" SET SCHEMA portal;
-- 없으면 아래 CREATE TYPE으로 생성:
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'PaymentStatus' AND n.nspname = 'portal') THEN
    CREATE TYPE portal."PaymentStatus" AS ENUM (
      'pending',
      'paid',
      'failed',
      'cancelled',
      'refunded',
      'deferred'
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: ChargeSessionProjection 테이블 신규 생성 (portal schema)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal."charge_session_projection" (
  "id"                   BIGSERIAL     NOT NULL,
  "coreTransactionId"    INTEGER       NOT NULL,
  "sessionId"            VARCHAR(100)  NOT NULL,
  "stationId"            VARCHAR(50)   NOT NULL,
  "siteId"               INTEGER,
  "partnerId"            INTEGER,
  "connectorId"          INTEGER       NOT NULL,
  "idTag"                VARCHAR(50),
  -- 충전 데이터
  "meterStart"           BIGINT        NOT NULL DEFAULT 0,
  "meterStop"            BIGINT,
  "totalKwh"             DECIMAL(12,3),
  "timeStart"            TIMESTAMPTZ   NOT NULL,
  "timeEnd"              TIMESTAMPTZ,
  "status"               VARCHAR(30)   NOT NULL,
  "stopReason"           VARCHAR(100),
  -- 금액
  "costVnd"              BIGINT,
  "unitPriceVnd"         INTEGER,
  "marginRate"           DECIMAL(5,2),
  -- 정산 정책 스냅샷
  "settlementSchedule"   portal."SettlementSchedule",
  "settlementDay"        SMALLINT,
  "settlementDayOfWeek"  SMALLINT,
  -- Portal 비즈니스 필드 (Core에서 이전)
  "paymentStatus"        portal."PaymentStatus",
  "settlementId"         INTEGER,
  -- 메타
  "lastEventAt"          TIMESTAMPTZ   NOT NULL,
  "createdAt"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "charge_session_projection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "charge_session_projection_coreTransactionId_key" UNIQUE ("coreTransactionId"),
  CONSTRAINT "charge_session_projection_sessionId_key" UNIQUE ("sessionId"),

  -- Portal 내부 FK (동일 schema)
  CONSTRAINT "charge_session_projection_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES portal."charging_site"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "charge_session_projection_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES portal."partner_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "charge_session_projection_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES portal."settlement"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS "charge_session_projection_stationId_idx"
  ON portal."charge_session_projection"("stationId");
CREATE INDEX IF NOT EXISTS "charge_session_projection_sessionId_idx"
  ON portal."charge_session_projection"("sessionId");
CREATE INDEX IF NOT EXISTS "charge_session_projection_status_idx"
  ON portal."charge_session_projection"("status");
CREATE INDEX IF NOT EXISTS "charge_session_projection_paymentStatus_idx"
  ON portal."charge_session_projection"("paymentStatus");
CREATE INDEX IF NOT EXISTS "charge_session_projection_siteId_idx"
  ON portal."charge_session_projection"("siteId");
CREATE INDEX IF NOT EXISTS "charge_session_projection_partnerId_idx"
  ON portal."charge_session_projection"("partnerId");
CREATE INDEX IF NOT EXISTS "charge_session_projection_settlementId_idx"
  ON portal."charge_session_projection"("settlementId");

-- updatedAt 자동 갱신 트리거 (Prisma @updatedAt 대체)
CREATE OR REPLACE FUNCTION portal.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "charge_session_projection_updated_at"
  BEFORE UPDATE ON portal."charge_session_projection"
  FOR EACH ROW EXECUTE FUNCTION portal.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: 데이터 백필
-- Core Transaction 기존 데이터를 ChargeSessionProjection으로 복사
-- (paymentStatus, settlementId 포함 — 이후 Core에서 해당 컬럼 제거)
--
-- 주의사항:
--  - core.Transaction → portal.charge_session_projection 크로스 스키마 INSERT
--  - PostgreSQL 동일 인스턴스 내 크로스 스키마 쿼리 지원됨
--  - stationId 기반 siteId/partnerId 조회: charging_station.siteId → charging_site.partnerId
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO portal."charge_session_projection" (
  "coreTransactionId",
  "sessionId",
  "stationId",
  "siteId",
  "partnerId",
  "connectorId",
  "idTag",
  "meterStart",
  "meterStop",
  "totalKwh",
  "timeStart",
  "timeEnd",
  "status",
  "stopReason",
  "costVnd",
  "unitPriceVnd",
  "marginRate",
  "settlementSchedule",
  "settlementDay",
  "settlementDayOfWeek",
  "paymentStatus",
  "settlementId",
  "lastEventAt",
  "createdAt"
)
SELECT
  t."id"                    AS "coreTransactionId",
  t."sessionId",
  t."stationId",
  cs."siteId",
  site."partnerId",
  t."connectorId",
  t."idTag",
  t."meterStart"::BIGINT,
  t."meterEnd"::BIGINT        AS "meterStop",
  CASE WHEN t."meterEnd" IS NOT NULL AND t."meterStart" IS NOT NULL
       THEN ROUND((t."meterEnd" - t."meterStart")::NUMERIC / 1000, 3)
       ELSE NULL END           AS "totalKwh",
  t."timeStart",
  t."timeEnd",
  t."status"::TEXT,
  NULL                        AS "stopReason",
  t."costVnd"::BIGINT,
  t."unitPriceVnd",
  t."marginRate",
  t."settlementSchedule"      AS "settlementSchedule",
  t."settlementDay",
  t."settlementDayOfWeek",
  t."paymentStatus"::portal."PaymentStatus",
  t."settlementId",
  COALESCE(t."timeEnd", t."timeStart", t."createdAt") AS "lastEventAt",
  t."createdAt"
FROM core."transaction" t
LEFT JOIN core."charging_station" cs ON cs."id" = t."stationId"
LEFT JOIN portal."charging_site" site ON site."id" = cs."siteId"
ON CONFLICT ("coreTransactionId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: 데이터 검증 쿼리 (수동 실행 권장)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM core."transaction";
-- SELECT COUNT(*) FROM portal."charge_session_projection";
-- -- 두 count가 일치해야 함
--
-- -- 샘플 검증
-- SELECT t."id", t."paymentStatus", csp."paymentStatus", t."settlementId", csp."settlementId"
-- FROM core."transaction" t
-- JOIN portal."charge_session_projection" csp ON csp."coreTransactionId" = t."id"
-- WHERE t."paymentStatus" IS NOT NULL
-- LIMIT 20;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Core Transaction에서 paymentStatus, settlementId 컬럼 제거
-- ⚠️ 데이터 검증 완료 후 실행할 것
-- ─────────────────────────────────────────────────────────────────────────────

-- 5-1. settlementId FK 제약 제거
ALTER TABLE core."transaction"
  DROP CONSTRAINT IF EXISTS "transaction_settlementId_fkey";

-- 5-2. paymentStatus 인덱스 제거 (복합 인덱스 포함)
DROP INDEX IF EXISTS core."transaction_paymentStatus_settlementId_idx";
DROP INDEX IF EXISTS core."transaction_settlementId_idx";

-- 5-3. 컬럼 제거 (옵션 C: settlementSchedule/settlementDay는 Core에 유지)
ALTER TABLE core."transaction"
  DROP COLUMN IF EXISTS "paymentStatus",
  DROP COLUMN IF EXISTS "settlementId";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Cross-schema FK 제약 제거 (Logical FK로 전환)
-- ─────────────────────────────────────────────────────────────────────────────

-- 6-1. ChargingStation.siteId → ChargingSite.id FK 제거 (core → portal Logical FK)
ALTER TABLE core."charging_station"
  DROP CONSTRAINT IF EXISTS "charging_station_siteId_fkey";

-- 6-2. RefundLog.transactionId → Transaction.id FK 제거 (portal → core Logical FK)
ALTER TABLE portal."refund_log"
  DROP CONSTRAINT IF EXISTS "refund_log_transactionId_fkey";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: PaymentStatus enum을 core에서 제거 (portal로 이전 완료 후)
-- NOTE: core."PaymentStatus"가 Transaction에서만 사용됐으므로 컬럼 제거 후 enum 제거 가능
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP TYPE IF EXISTS core."PaymentStatus";
-- (core."PaymentStatus"가 존재하는 경우에만 실행. portal."PaymentStatus"로 이전 완료 확인 후.)
