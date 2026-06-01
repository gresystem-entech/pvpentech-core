-- Migration: add chargingKwh to charger_provisioning
-- upstream chargeplus PR #61 (0786388) 반영 — split 컨벤션: core schema 한정
-- 2026-05-28

ALTER TABLE core."charger_provisioning"
  ADD COLUMN IF NOT EXISTS "chargingKwh" DECIMAL(6, 2) NOT NULL DEFAULT 3.5;
