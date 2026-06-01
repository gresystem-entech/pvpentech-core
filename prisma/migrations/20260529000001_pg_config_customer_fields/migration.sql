-- Migration: add customerId/customerName to payment_pg_config
-- upstream chargeplus PR #73 (b00bdcd) 반영 — split 컨벤션: portal schema 한정
-- VietQR(MB Bank) QR 생성에 필요한 가맹점 식별 필드

ALTER TABLE portal."payment_pg_config" ADD COLUMN IF NOT EXISTS "customerId" VARCHAR(100);
ALTER TABLE portal."payment_pg_config" ADD COLUMN IF NOT EXISTS "customerName" VARCHAR(255);

-- 기존 mbbank sandbox 설정 백필 (QR 즉시 동작)
UPDATE portal."payment_pg_config"
   SET "customerId" = '0108230311', "customerName" = 'TEST.CHUHANG'
 WHERE "pgType" = 'mbbank' AND ("customerId" IS NULL OR "customerId" = '');
