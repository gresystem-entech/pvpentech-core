-- OCPP 1.6 신규 스펙 준수 (Phase 2)
-- 1) Connector: StatusNotification 부가 정보 컬럼
-- 2) MeterValue: SampledValue context/format/location 컬럼
-- 3) ChargingStation: 최신 FirmwareStatus / DiagnosticsStatus

ALTER TABLE "connector"
  ADD COLUMN IF NOT EXISTS "errorCode"       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "info"            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "vendorId"        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "vendorErrorCode" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "statusTimestamp" TIMESTAMP(3);

ALTER TABLE "meter_value"
  ADD COLUMN IF NOT EXISTS "context"  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "format"   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "location" VARCHAR(20);

ALTER TABLE "charging_station"
  ADD COLUMN IF NOT EXISTS "firmwareStatus"    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "diagnosticsStatus" VARCHAR(30);
