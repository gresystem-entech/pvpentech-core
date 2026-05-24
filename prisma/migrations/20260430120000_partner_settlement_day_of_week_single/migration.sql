-- Revert from settlementDaysOfWeek Int[] to single settlementDayOfWeek Int? @db.SmallInt
-- (V2 settlement-day UI uses single-select dropdown, 1=월요일 ~ 5=금요일)
--
-- 멱등 처리: 일부 환경에서는 중간 단계의 settlementDaysOfWeek Int[] 컬럼이
-- 추가된 적이 없거나, init 마이그레이션이 이미 settlementDayOfWeek SMALLINT 를
-- 생성한 상태이므로 IF EXISTS / IF NOT EXISTS 로 보호한다.

-- AlterTable
ALTER TABLE "partner_profile" DROP COLUMN IF EXISTS "settlementDaysOfWeek";
ALTER TABLE "partner_profile" ADD COLUMN IF NOT EXISTS "settlementDayOfWeek" SMALLINT;
