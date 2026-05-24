-- Migration: 20260524000001_add_outbox_consumed_event
-- Phase 2-A: Outbox 패턴 인프라 테이블 추가
-- 운영 적용: prisma migrate deploy 로 실행 (데이터 마이그레이션 불필요)

-- ─────────────────────────────────────────────
-- outbox_event: 트랜잭션 내 이벤트 기록 테이블
-- ─────────────────────────────────────────────
CREATE TABLE "outbox_event" (
    "id"            BIGSERIAL        NOT NULL,
    "eventId"       VARCHAR(36)      NOT NULL,
    "eventType"     TEXT             NOT NULL,
    "aggregateType" TEXT,
    "aggregateId"   TEXT,
    "payload"       JSONB            NOT NULL,
    "occurredAt"    TIMESTAMPTZ(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt"   TIMESTAMPTZ(3),
    "attempts"      INTEGER          NOT NULL DEFAULT 0,
    "lastError"     TEXT,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- unique: eventId (Consumer idempotency 키)
CREATE UNIQUE INDEX "outbox_event_eventId_key" ON "outbox_event"("eventId");

-- index: relay가 publishedAt IS NULL 빠르게 조회
CREATE INDEX "outbox_event_publishedAt_idx" ON "outbox_event"("publishedAt");

-- index: eventType 조회용
CREATE INDEX "outbox_event_eventType_idx" ON "outbox_event"("eventType");

-- ─────────────────────────────────────────────
-- consumed_event: Portal Consumer 중복 처리 방지 테이블
-- ─────────────────────────────────────────────
CREATE TABLE "consumed_event" (
    "eventId"     VARCHAR(36)      NOT NULL,
    "eventType"   TEXT             NOT NULL,
    "processedAt" TIMESTAMPTZ(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultJson"  JSONB,

    CONSTRAINT "consumed_event_pkey" PRIMARY KEY ("eventId")
);

-- index: 오래된 consumed_event 정리용 (processedAt 기준)
CREATE INDEX "consumed_event_processedAt_idx" ON "consumed_event"("processedAt");

-- index: eventType 조회용
CREATE INDEX "consumed_event_eventType_idx" ON "consumed_event"("eventType");
