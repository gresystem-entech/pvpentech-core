-- OCPP Phase 4-A — 진단 파일 업로드 요청 추적 (REQ-DIAG-002)

-- 1) Enum
DO $$ BEGIN
  CREATE TYPE "DiagnosticsStatus" AS ENUM ('Idle', 'Uploading', 'Uploaded', 'UploadFailed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) Table
CREATE TABLE IF NOT EXISTS "diagnostics_request" (
  "id"             SERIAL              PRIMARY KEY,
  "messageId"      VARCHAR(50)         NOT NULL UNIQUE,
  "stationId"      VARCHAR(50)         NOT NULL,
  "status"         "DiagnosticsStatus" NOT NULL DEFAULT 'Idle',
  "fileName"       VARCHAR(255),
  "uploadLocation" VARCHAR(500),
  "startTime"      TIMESTAMP(3),
  "stopTime"       TIMESTAMP(3),
  "retries"        INTEGER,
  "retryInterval"  INTEGER,
  "requestedBy"    VARCHAR(150),
  "requestedAt"    TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3)
);

-- 3) FK
DO $$ BEGIN
  ALTER TABLE "diagnostics_request"
    ADD CONSTRAINT "diagnostics_request_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "charging_station"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 4) Indexes
CREATE INDEX IF NOT EXISTS "diagnostics_request_stationId_requestedAt_idx"
  ON "diagnostics_request"("stationId", "requestedAt");
CREATE INDEX IF NOT EXISTS "diagnostics_request_status_idx"
  ON "diagnostics_request"("status");
