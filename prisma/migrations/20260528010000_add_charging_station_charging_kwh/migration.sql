-- Migration: add chargingKwh to charging_station
-- upstream chargeplus PR #61 (0786388) 반영 — split 컨벤션: core schema 한정
-- 2026-05-28

ALTER TABLE core."charging_station"
  ADD COLUMN IF NOT EXISTS "chargingKwh" DECIMAL(6, 2) NOT NULL DEFAULT 3.5;

-- provisioning 사전 등록값을 station 운영값으로 백필
UPDATE core."charging_station" cs
   SET "chargingKwh" = cp."chargingKwh"
  FROM core."charger_provisioning" cp
 WHERE cp."stationId" = cs."id";
