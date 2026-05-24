-- 기존 instant 행을 manual로 변환
UPDATE "settlement" SET "periodType" = 'manual' WHERE "periodType" = 'instant';

-- enum 값 제거 (Postgres enum swap 패턴)
ALTER TYPE "SettlementPeriod" RENAME TO "SettlementPeriod_old";
CREATE TYPE "SettlementPeriod" AS ENUM ('daily', 'weekly', 'monthly', 'manual');
ALTER TABLE "settlement"
  ALTER COLUMN "periodType" TYPE "SettlementPeriod"
  USING "periodType"::text::"SettlementPeriod";
DROP TYPE "SettlementPeriod_old";
