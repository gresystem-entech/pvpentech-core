-- Migration: settlement_index_marginrate
-- Phase L: Settlement 테이블 중복 체크 인덱스에 marginRate 추가.
-- 동일 (partner, periodEnd, periodType, settlementDay, settlementDayOfWeek)이라도
-- marginRate가 다르면 별개 Settlement로 인정 — alreadyDoneToday 쿼리 성능 보장.

-- 기존 인덱스 삭제 후 marginRate 포함 인덱스로 재생성
DROP INDEX IF EXISTS "settlement_partnerId_periodEnd_periodType_settlementDay_settl_idx";

CREATE INDEX "settlement_partnerId_periodEnd_periodType_settlementDay_settl_idx"
  ON "settlement"("partnerId", "periodEnd", "periodType", "settlementDay", "settlementDayOfWeek", "marginRate");
