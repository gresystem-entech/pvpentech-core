-- Migration: add audit_log (일반 비즈니스 데이터 변경 감사 로그)
-- upstream chargeplus PR #60 (7398979) 통합 반영
-- split 컨벤션: portal schema + audit_log 매핑 + BIGSERIAL PK 최종형태로 직접 생성
--   (upstream의 3단계 migration: AuditLog(TEXT) → audit_log → BIGINT 를 단일 최종형으로 압축)

-- CreateTable
CREATE TABLE IF NOT EXISTS portal."audit_log" (
    "id"            BIGSERIAL    NOT NULL,
    "requestId"     TEXT,
    "userId"        INTEGER,
    "userIp"        TEXT,
    "userAgent"     TEXT,
    "httpMethod"    TEXT,
    "httpPath"      TEXT,
    "model"         TEXT         NOT NULL,
    "action"        TEXT         NOT NULL,
    "resourceId"    TEXT,
    "before"        JSONB,
    "after"         JSONB,
    "changedFields" TEXT[],
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_model_resourceId_idx" ON portal."audit_log"("model", "resourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_userId_idx" ON portal."audit_log"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_createdAt_idx" ON portal."audit_log"("createdAt");
