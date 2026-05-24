-- OCPP Phase 4-B — 펌웨어 관리 (REQ-FW-001~003)

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE "FirmwareCampaignStatus" AS ENUM ('running', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FirmwareCampaignProgressStatus" AS ENUM (
    'queued', 'sent', 'downloading', 'downloaded',
    'installing', 'installed', 'failed', 'send_error'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) firmware
CREATE TABLE IF NOT EXISTS "firmware" (
  "id"            SERIAL        PRIMARY KEY,
  "filename"      VARCHAR(255)  NOT NULL UNIQUE,
  "originalName"  VARCHAR(255)  NOT NULL,
  "version"       VARCHAR(50)   NOT NULL,
  "chargerModel"  VARCHAR(100),
  "chargerVendor" VARCHAR(100),
  "fileSize"      INTEGER       NOT NULL,
  "sha256"        VARCHAR(64)   NOT NULL UNIQUE,
  "uploadedBy"    VARCHAR(150)  NOT NULL,
  "uploadedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isActive"      BOOLEAN       NOT NULL DEFAULT TRUE,
  "notes"         TEXT
);

CREATE INDEX IF NOT EXISTS "firmware_chargerModel_chargerVendor_idx"
  ON "firmware"("chargerModel", "chargerVendor");
CREATE INDEX IF NOT EXISTS "firmware_isActive_uploadedAt_idx"
  ON "firmware"("isActive", "uploadedAt");

-- 3) firmware_campaign
CREATE TABLE IF NOT EXISTS "firmware_campaign" (
  "id"           SERIAL                     PRIMARY KEY,
  "firmwareId"   INTEGER                    NOT NULL,
  "targetFilter" JSONB                      NOT NULL,
  "status"       "FirmwareCampaignStatus"   NOT NULL DEFAULT 'running',
  "startedBy"    VARCHAR(150)               NOT NULL,
  "startedAt"    TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "notes"        TEXT
);

DO $$ BEGIN
  ALTER TABLE "firmware_campaign"
    ADD CONSTRAINT "firmware_campaign_firmwareId_fkey"
    FOREIGN KEY ("firmwareId") REFERENCES "firmware"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "firmware_campaign_firmwareId_idx" ON "firmware_campaign"("firmwareId");
CREATE INDEX IF NOT EXISTS "firmware_campaign_status_startedAt_idx"
  ON "firmware_campaign"("status", "startedAt");

-- 4) firmware_campaign_progress
CREATE TABLE IF NOT EXISTS "firmware_campaign_progress" (
  "id"          SERIAL                              PRIMARY KEY,
  "campaignId"  INTEGER                             NOT NULL,
  "stationId"   VARCHAR(50),
  "status"      "FirmwareCampaignProgressStatus"    NOT NULL DEFAULT 'queued',
  "startedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "error"       VARCHAR(500),
  "updatedAt"   TIMESTAMP(3)                        NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "firmware_campaign_progress"
    ADD CONSTRAINT "firmware_campaign_progress_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "firmware_campaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "firmware_campaign_progress"
    ADD CONSTRAINT "firmware_campaign_progress_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "charging_station"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "firmware_campaign_progress_campaignId_stationId_key"
  ON "firmware_campaign_progress"("campaignId", "stationId");
CREATE INDEX IF NOT EXISTS "firmware_campaign_progress_campaignId_status_idx"
  ON "firmware_campaign_progress"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "firmware_campaign_progress_stationId_idx"
  ON "firmware_campaign_progress"("stationId");
