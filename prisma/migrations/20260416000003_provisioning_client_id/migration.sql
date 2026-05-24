-- Migration: provisioning_client_id
-- 2026-04-16

-- ChargerProvisioning에 clientId 컬럼 추가 (사전 지정 충전기 아이디)
ALTER TABLE "charger_provisioning"
  ADD COLUMN IF NOT EXISTS "clientId" VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS "charger_provisioning_clientId_key"
  ON "charger_provisioning"("clientId");
