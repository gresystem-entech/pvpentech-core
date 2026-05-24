-- Migration: provisioning_model_name
-- 2026-04-16

-- ChargerProvisioning에 modelName 컬럼 추가
ALTER TABLE "charger_provisioning"
  ADD COLUMN IF NOT EXISTS "modelName" VARCHAR(100);

-- station_id_sequence 시드 레코드 보장 (없으면 삽입)
INSERT INTO "station_id_sequence" ("id", "lastNumber")
VALUES (1, 1000000)
ON CONFLICT ("id") DO NOTHING;
