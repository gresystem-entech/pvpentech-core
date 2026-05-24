-- Migration: settlement_failure_recovery
-- M-1: SettlementStatus enum에 needs_review 추가
-- M-1: Settlement 모델에 failedTransactionIds Json? 컬럼 추가

-- Enum에 새 값 추가 (PostgreSQL은 ALTER TYPE ... ADD VALUE로 enum 확장)
ALTER TYPE "SettlementStatus" ADD VALUE IF NOT EXISTS 'needs_review';

-- failedTransactionIds 컬럼 추가
ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "failedTransactionIds" JSONB;
