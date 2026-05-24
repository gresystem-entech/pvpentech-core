-- Migration: settlement_marginrate_nullable
-- Phase 3 사전 처리: Settlement.marginRate 컬럼을 nullable로 변경
-- 그룹 settlement에서 거래별 마진율이 혼합인 경우 단일값으로 표현 불가하므로 NULL 허용.
-- 그룹 내 마진율이 모두 동일하면 해당 값을 저장, 다르면 NULL.

ALTER TABLE "settlement" ALTER COLUMN "marginRate" DROP NOT NULL;
