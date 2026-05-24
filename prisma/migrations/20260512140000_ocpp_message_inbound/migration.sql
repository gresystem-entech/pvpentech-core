-- ocpp_message 에 inbound 컬럼 추가 — 송신/수신 구분
-- 기존 row 는 모두 CP→CSMS 수신만 로그됐으므로 default true 안전

ALTER TABLE "ocpp_message"
  ADD COLUMN IF NOT EXISTS "inbound" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "ocpp_message_inbound_createdAt_idx"
  ON "ocpp_message"("inbound", "createdAt");
