-- OCPP Phase 3 — CSMS→CP 명령 응답 결과 영속화 (REQ-CONF-001)
-- 인메모리 pendingRequests 와 별개로 운영자 후행 조회·감사용

-- 1) Enum
DO $$ BEGIN
  CREATE TYPE "OcppCommandStatus" AS ENUM ('pending', 'completed', 'error', 'timeout');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) Table
CREATE TABLE IF NOT EXISTS "ocpp_command_result" (
  "id"               SERIAL              PRIMARY KEY,
  "messageId"        VARCHAR(50)         NOT NULL UNIQUE,
  "stationId"        VARCHAR(50),
  "action"           VARCHAR(50)         NOT NULL,
  "status"           "OcppCommandStatus" NOT NULL DEFAULT 'pending',
  "requestPayload"   JSONB               NOT NULL,
  "responsePayload"  JSONB,
  "errorCode"        VARCHAR(50),
  "errorDescription" VARCHAR(500),
  "requestedBy"      VARCHAR(150),
  "sentAt"           TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedAt"       TIMESTAMP(3)
);

-- 3) FK (SetNull — station 삭제 시 명령 이력은 보존)
DO $$ BEGIN
  ALTER TABLE "ocpp_command_result"
    ADD CONSTRAINT "ocpp_command_result_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "charging_station"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 4) Indexes
CREATE INDEX IF NOT EXISTS "ocpp_command_result_stationId_sentAt_idx"
  ON "ocpp_command_result"("stationId", "sentAt");
CREATE INDEX IF NOT EXISTS "ocpp_command_result_action_sentAt_idx"
  ON "ocpp_command_result"("action", "sentAt");
CREATE INDEX IF NOT EXISTS "ocpp_command_result_status_sentAt_idx"
  ON "ocpp_command_result"("status", "sentAt");
