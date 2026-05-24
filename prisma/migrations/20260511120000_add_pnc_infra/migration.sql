-- ISO 15118 PnC — Phase A-1 infra
-- 근거: documents/design_guide/csms_pnc_implementation_spec_2026-05-11.md

-- 1) Enum
DO $$ BEGIN
  CREATE TYPE "PncCsrStatus" AS ENUM ('pending', 'signed', 'delivered', 'rejected', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) pnc_installed_certificate
CREATE TABLE IF NOT EXISTS "pnc_installed_certificate" (
  "id"              SERIAL        PRIMARY KEY,
  "stationId"       VARCHAR(50)   NOT NULL,
  "certificateType" VARCHAR(50)   NOT NULL,
  "serialNumber"    VARCHAR(255)  NOT NULL,
  "issuerNameHash"  VARCHAR(255)  NOT NULL,
  "issuerKeyHash"   VARCHAR(255)  NOT NULL,
  "hashAlgorithm"   VARCHAR(20)   NOT NULL,
  "pemBody"         TEXT,
  "notBefore"       TIMESTAMP(3)  NOT NULL,
  "notAfter"        TIMESTAMP(3)  NOT NULL,
  "installedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"       TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "pnc_installed_certificate"
    ADD CONSTRAINT "pnc_installed_certificate_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "charging_station"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "pnc_installed_certificate_stationId_serialNumber_key"
  ON "pnc_installed_certificate"("stationId", "serialNumber");
CREATE INDEX IF NOT EXISTS "pnc_installed_certificate_stationId_certificateType_idx"
  ON "pnc_installed_certificate"("stationId", "certificateType");
CREATE INDEX IF NOT EXISTS "pnc_installed_certificate_notAfter_idx"
  ON "pnc_installed_certificate"("notAfter");
CREATE INDEX IF NOT EXISTS "pnc_installed_certificate_revokedAt_idx"
  ON "pnc_installed_certificate"("revokedAt");

-- 3) pnc_csr_in_progress
CREATE TABLE IF NOT EXISTS "pnc_csr_in_progress" (
  "id"              SERIAL          PRIMARY KEY,
  "messageId"       VARCHAR(50)     NOT NULL UNIQUE,
  "stationId"       VARCHAR(50)     NOT NULL,
  "csrPem"          TEXT            NOT NULL,
  "csrSha256"       VARCHAR(64)     NOT NULL,
  "status"          "PncCsrStatus"  NOT NULL DEFAULT 'pending',
  "evseIdFromSan"   VARCHAR(100),
  "leafCertSerial"  VARCHAR(255),
  "leafCertPem"     TEXT,
  "certChainPem"    TEXT,
  "pkiErrorCode"    VARCHAR(100),
  "pkiErrorMessage" VARCHAR(500),
  "requestedAt"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pkiCompletedAt"  TIMESTAMP(3),
  "deliveredAt"     TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "pnc_csr_in_progress"
    ADD CONSTRAINT "pnc_csr_in_progress_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "charging_station"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "pnc_csr_in_progress_stationId_csrSha256_key"
  ON "pnc_csr_in_progress"("stationId", "csrSha256");
CREATE INDEX IF NOT EXISTS "pnc_csr_in_progress_status_requestedAt_idx"
  ON "pnc_csr_in_progress"("status", "requestedAt");

-- 4) pnc_audit_log (append-only — station FK 없음, 보존 우선)
CREATE TABLE IF NOT EXISTS "pnc_audit_log" (
  "id"             BIGSERIAL    PRIMARY KEY,
  "eventType"      VARCHAR(50)  NOT NULL,
  "stationId"      VARCHAR(50),
  "eMaid"          VARCHAR(100),
  "certSerial"     VARCHAR(255),
  "ocppMessageId"  VARCHAR(50),
  "status"         VARCHAR(50),
  "details"        JSONB,
  "occurredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pnc_audit_log_eventType_occurredAt_idx"
  ON "pnc_audit_log"("eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "pnc_audit_log_stationId_occurredAt_idx"
  ON "pnc_audit_log"("stationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "pnc_audit_log_occurredAt_idx"
  ON "pnc_audit_log"("occurredAt");
