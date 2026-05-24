-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('Online', 'Offline', 'Faulted', 'Inspecting', 'CommunicationFault', 'Unknown');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('Available', 'Preparing', 'Charging', 'SuspendedEVSE', 'SuspendedEV', 'Finishing', 'Reserved', 'Unavailable', 'Faulted');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('cs', 'partner', 'customer');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "SettlementSchedule" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "IdTokenType" AS ENUM ('Central', 'eMAID', 'ISO14443', 'ISO15693', 'KeyCode', 'Local', 'MacAddress', 'NoAuthorization');

-- CreateEnum
CREATE TYPE "IdTokenStatus" AS ENUM ('Accepted', 'Blocked', 'Expired', 'Invalid', 'ConcurrentTx');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('time', 'kwh', 'amount', 'free');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('Pending', 'Active', 'Stopped', 'Failed');

-- CreateEnum
CREATE TYPE "FaultType" AS ENUM ('ConnectorFault', 'CommunicationError', 'PowerFault', 'Other');

-- CreateEnum
CREATE TYPE "FaultStatus" AS ENUM ('Received', 'InProgress', 'Resolved');

-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('registered', 'provisioned', 'rejected', 'revoked');

-- CreateEnum
CREATE TYPE "SettlementPeriod" AS ENUM ('daily', 'weekly', 'monthly', 'instant');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ChargerConfigStatus" AS ENUM ('normal', 'error');

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(150) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "email" VARCHAR(254),
    "firstName" VARCHAR(50),
    "lastName" VARCHAR(50),
    "phone" VARCHAR(20),
    "language" VARCHAR(10),
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_profile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "businessName" VARCHAR(200) NOT NULL,
    "businessNo" VARCHAR(20),
    "contactPhone" VARCHAR(20),
    "marginRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "settlementDay" SMALLINT,
    "settlementSchedule" "SettlementSchedule" NOT NULL DEFAULT 'monthly',
    "settlementDayOfWeek" SMALLINT,
    "bankName" VARCHAR(100),
    "bankAccount" VARCHAR(50),
    "bankAccountHolder" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging_site" (
    "id" SERIAL NOT NULL,
    "siteName" VARCHAR(200) NOT NULL,
    "address" VARCHAR(500),
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 250,
    "rebateRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "partnerId" INTEGER,
    "chargeOperatorName" VARCHAR(200),
    "managerName" VARCHAR(100),
    "managerPhone" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charging_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging_station" (
    "id" VARCHAR(50) NOT NULL,
    "modelName" VARCHAR(100),
    "vendorName" VARCHAR(100),
    "manufacturer" VARCHAR(100),
    "firmwareVersion" VARCHAR(50),
    "serialNumber" VARCHAR(100),
    "passwordHash" VARCHAR(255),
    "status" "StationStatus" NOT NULL DEFAULT 'Offline',
    "lastHeartbeatAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "siteId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charging_station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector" (
    "id" SERIAL NOT NULL,
    "stationId" VARCHAR(50) NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "connectorType" VARCHAR(30),
    "currentStatus" "ConnectorStatus" NOT NULL DEFAULT 'Available',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_card" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "nickname" VARCHAR(100),
    "cardLast4" VARCHAR(4) NOT NULL,
    "cardType" VARCHAR(50),
    "billingKey" VARCHAR(500),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "id_token" (
    "id" SERIAL NOT NULL,
    "idTag" VARCHAR(50) NOT NULL,
    "type" "IdTokenType" NOT NULL DEFAULT 'ISO14443',
    "status" "IdTokenStatus" NOT NULL DEFAULT 'Accepted',
    "expiryDate" TIMESTAMP(3),
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "id_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" SERIAL NOT NULL,
    "sessionId" VARCHAR(100) NOT NULL,
    "ocppTransactionId" INTEGER,
    "stationId" VARCHAR(50) NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "idTag" VARCHAR(50),
    "goalType" "GoalType",
    "goalValue" DECIMAL(10,2),
    "status" "TransactionStatus" NOT NULL DEFAULT 'Pending',
    "meterStart" INTEGER NOT NULL DEFAULT 0,
    "meterEnd" INTEGER,
    "timeStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeEnd" TIMESTAMP(3),
    "costKrw" INTEGER,
    "failReason" VARCHAR(255),
    "paymentStatus" "PaymentStatus",
    "paymentMethod" VARCHAR(50),
    "pgTransactionId" VARCHAR(200),
    "unitPriceKrw" INTEGER,
    "marginRate" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_value" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "measurand" VARCHAR(100) NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(20),
    "phase" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_variable" (
    "id" SERIAL NOT NULL,
    "stationId" VARCHAR(50) NOT NULL,
    "componentName" VARCHAR(100) NOT NULL,
    "variableName" VARCHAR(100) NOT NULL,
    "variableValue" TEXT,
    "isReadonly" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_variable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpp_message" (
    "id" SERIAL NOT NULL,
    "stationId" VARCHAR(50) NOT NULL,
    "messageId" VARCHAR(100) NOT NULL,
    "direction" INTEGER NOT NULL,
    "action" VARCHAR(50),
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocpp_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fault_log" (
    "id" SERIAL NOT NULL,
    "stationId" VARCHAR(50) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faultType" "FaultType" NOT NULL,
    "description" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "reportedBy" VARCHAR(150),
    "status" "FaultStatus" NOT NULL DEFAULT 'Received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fault_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charger_provisioning" (
    "id" SERIAL NOT NULL,
    "serialNumber" VARCHAR(100) NOT NULL,
    "stationId" VARCHAR(50),
    "status" "ProvisioningStatus" NOT NULL DEFAULT 'registered',
    "registeredBy" VARCHAR(150),
    "provisionedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charger_provisioning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_id_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastNumber" INTEGER NOT NULL DEFAULT 1000000,

    CONSTRAINT "station_id_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement" (
    "id" SERIAL NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "siteId" INTEGER,
    "stationId" VARCHAR(50),
    "periodType" "SettlementPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalKwh" DECIMAL(12,4) NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "marginRate" DECIMAL(5,2) NOT NULL,
    "settlementAmount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "settledAt" TIMESTAMP(3),
    "settledBy" VARCHAR(150),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_log" (
    "id" SERIAL NOT NULL,
    "stationId" VARCHAR(50) NOT NULL,
    "siteId" INTEGER,
    "partnerId" INTEGER,
    "status" "StationStatus" NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "offline_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_log" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "userId" INTEGER,
    "paidAmount" INTEGER NOT NULL,
    "chargedAmount" INTEGER NOT NULL,
    "refundAmount" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "pgRefundId" VARCHAR(200),
    "note" VARCHAR(500),

    CONSTRAINT "refund_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charger_config" (
    "id" SERIAL NOT NULL,
    "stationId" VARCHAR(50) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT,
    "status" "ChargerConfigStatus" NOT NULL DEFAULT 'normal',
    "errorDesc" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charger_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csms_variable" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "description" VARCHAR(500),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "csms_variable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");
CREATE UNIQUE INDEX "partner_profile_userId_key" ON "partner_profile"("userId");
CREATE UNIQUE INDEX "connector_stationId_connectorId_key" ON "connector"("stationId", "connectorId");
CREATE UNIQUE INDEX "id_token_idTag_key" ON "id_token"("idTag");
CREATE UNIQUE INDEX "transaction_sessionId_key" ON "transaction"("sessionId");
CREATE UNIQUE INDEX "device_variable_stationId_componentName_variableName_key" ON "device_variable"("stationId", "componentName", "variableName");
CREATE UNIQUE INDEX "charger_provisioning_serialNumber_key" ON "charger_provisioning"("serialNumber");
CREATE UNIQUE INDEX "charger_provisioning_stationId_key" ON "charger_provisioning"("stationId");
CREATE UNIQUE INDEX "refund_log_transactionId_key" ON "refund_log"("transactionId");
CREATE UNIQUE INDEX "charger_config_stationId_key_key" ON "charger_config"("stationId", "key");
CREATE UNIQUE INDEX "csms_variable_key_key" ON "csms_variable"("key");

-- CreateIndex (non-unique)
CREATE INDEX "transaction_stationId_idx" ON "transaction"("stationId");
CREATE INDEX "transaction_timeStart_idx" ON "transaction"("timeStart");
CREATE INDEX "transaction_status_idx" ON "transaction"("status");
CREATE INDEX "meter_value_transactionId_timestamp_idx" ON "meter_value"("transactionId", "timestamp");
CREATE INDEX "ocpp_message_stationId_createdAt_idx" ON "ocpp_message"("stationId", "createdAt");
CREATE INDEX "ocpp_message_createdAt_idx" ON "ocpp_message"("createdAt");
CREATE INDEX "ocpp_message_action_idx" ON "ocpp_message"("action");
CREATE INDEX "ocpp_message_stationId_action_idx" ON "ocpp_message"("stationId", "action");
CREATE INDEX "fault_log_stationId_idx" ON "fault_log"("stationId");
CREATE INDEX "fault_log_reportedAt_idx" ON "fault_log"("reportedAt");
CREATE INDEX "fault_log_resolvedAt_idx" ON "fault_log"("resolvedAt");
CREATE INDEX "fault_log_status_idx" ON "fault_log"("status");
CREATE INDEX "charger_provisioning_serialNumber_idx" ON "charger_provisioning"("serialNumber");
CREATE INDEX "charger_provisioning_status_idx" ON "charger_provisioning"("status");
CREATE INDEX "settlement_partnerId_periodStart_idx" ON "settlement"("partnerId", "periodStart");
CREATE INDEX "settlement_siteId_periodStart_idx" ON "settlement"("siteId", "periodStart");
CREATE INDEX "settlement_status_idx" ON "settlement"("status");
CREATE INDEX "offline_log_stationId_loggedAt_idx" ON "offline_log"("stationId", "loggedAt");
CREATE INDEX "offline_log_loggedAt_idx" ON "offline_log"("loggedAt");
CREATE INDEX "refund_log_userId_idx" ON "refund_log"("userId");
CREATE INDEX "refund_log_status_idx" ON "refund_log"("status");
CREATE INDEX "refund_log_requestedAt_idx" ON "refund_log"("requestedAt");
CREATE INDEX "charger_config_stationId_idx" ON "charger_config"("stationId");

-- AddForeignKey
ALTER TABLE "partner_profile" ADD CONSTRAINT "partner_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charging_site" ADD CONSTRAINT "charging_site_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "charging_station" ADD CONSTRAINT "charging_station_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "charging_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "connector" ADD CONSTRAINT "connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_card" ADD CONSTRAINT "payment_card_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "id_token" ADD CONSTRAINT "id_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_idTag_fkey" FOREIGN KEY ("idTag") REFERENCES "id_token"("idTag") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meter_value" ADD CONSTRAINT "meter_value_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_variable" ADD CONSTRAINT "device_variable_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ocpp_message" ADD CONSTRAINT "ocpp_message_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fault_log" ADD CONSTRAINT "fault_log_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charger_provisioning" ADD CONSTRAINT "charger_provisioning_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "charging_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offline_log" ADD CONSTRAINT "offline_log_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "charging_station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_log" ADD CONSTRAINT "refund_log_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_log" ADD CONSTRAINT "refund_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: station_id_sequence 초기값
INSERT INTO "station_id_sequence" ("id", "lastNumber") VALUES (1, 1000000) ON CONFLICT DO NOTHING;
