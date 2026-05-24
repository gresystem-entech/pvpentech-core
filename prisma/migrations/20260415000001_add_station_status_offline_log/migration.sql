-- Migration: add_station_status_offline_log
-- 2026-04-15

-- 1. StationStatus enum에 새 값 추가
ALTER TYPE "StationStatus" ADD VALUE IF NOT EXISTS 'Inspecting';
ALTER TYPE "StationStatus" ADD VALUE IF NOT EXISTS 'CommunicationFault';
ALTER TYPE "StationStatus" ADD VALUE IF NOT EXISTS 'Unknown';

-- 2. OfflineLog 테이블 생성 (skip if already exists)
CREATE TABLE IF NOT EXISTS "offline_log" (
    "id"          SERIAL PRIMARY KEY,
    "stationId"   VARCHAR(50)    NOT NULL,
    "siteId"      INTEGER,
    "partnerId"   INTEGER,
    "status"      "StationStatus" NOT NULL,
    "loggedAt"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"  TIMESTAMP(3),

    CONSTRAINT "offline_log_stationId_fkey"
        FOREIGN KEY ("stationId") REFERENCES "charging_station"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS "offline_log_stationId_loggedAt_idx" ON "offline_log"("stationId", "loggedAt");
CREATE INDEX IF NOT EXISTS "offline_log_loggedAt_idx"            ON "offline_log"("loggedAt");
