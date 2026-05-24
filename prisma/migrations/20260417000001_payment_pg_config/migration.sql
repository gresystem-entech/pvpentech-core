-- CreateEnum
CREATE TYPE "PayOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED', 'TIMEOUT');

-- CreateTable: payment_pg_config (pg_config은 PostgreSQL 내장 시스템 뷰와 충돌)
CREATE TABLE "payment_pg_config" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "pgType" VARCHAR(50) NOT NULL DEFAULT 'mbbank',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "isSandbox" BOOLEAN NOT NULL DEFAULT true,
  "accessCode" VARCHAR(100) NOT NULL,
  "merchantId" VARCHAR(100) NOT NULL,
  "hashKey" VARCHAR(255) NOT NULL,
  "invoiceTaxcode" VARCHAR(50),
  "createOrderUrl" VARCHAR(500) NOT NULL,
  "refundUrl" VARCHAR(500) NOT NULL,
  "detailUrl" VARCHAR(500) NOT NULL,
  "ipnUrl" VARCHAR(500) NOT NULL,
  "returnUrl" VARCHAR(500) NOT NULL,
  "cancelUrl" VARCHAR(500) NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'VND',
  "paymentTimeoutMin" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_pg_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable: payment_order
CREATE TABLE "payment_order" (
  "id" SERIAL NOT NULL,
  "sessionId" VARCHAR(100) NOT NULL,
  "pgConfigId" INTEGER NOT NULL,
  "orderReference" VARCHAR(100) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'VND',
  "paymentMethod" VARCHAR(20),
  "status" "PayOrderStatus" NOT NULL DEFAULT 'PENDING',
  "isMock" BOOLEAN NOT NULL DEFAULT false,
  "pgSessionId" VARCHAR(200),
  "paymentUrl" VARCHAR(1000),
  "qrUrl" VARCHAR(1000),
  "expireTime" TIMESTAMP(3),
  "pgTransactionNo" VARCHAR(200),
  "issuerTxnRef" VARCHAR(200),
  "ipnReceivedAt" TIMESTAMP(3),
  "ipnRawPayload" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_order_pkey" PRIMARY KEY ("id")
);

-- Unique & Indexes
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_orderReference_key" UNIQUE ("orderReference");
CREATE INDEX "payment_order_sessionId_idx" ON "payment_order"("sessionId");
CREATE INDEX "payment_order_status_idx" ON "payment_order"("status");
CREATE INDEX "payment_order_expiresAt_idx" ON "payment_order"("expiresAt");

-- FK
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_pgConfigId_fkey"
  FOREIGN KEY ("pgConfigId") REFERENCES "payment_pg_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rename columns on transaction
ALTER TABLE "transaction" RENAME COLUMN "costKrw" TO "costVnd";
ALTER TABLE "transaction" RENAME COLUMN "unitPriceKrw" TO "unitPriceVnd";
