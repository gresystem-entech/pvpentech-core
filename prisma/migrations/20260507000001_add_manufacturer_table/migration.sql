-- CreateTable: manufacturer (v2.0 신규)
CREATE TABLE "manufacturer" (
    "id"          SERIAL          NOT NULL,
    "channelId"   VARCHAR(50)     NOT NULL,
    "name"        VARCHAR(100)    NOT NULL,
    "tokenHash"   VARCHAR(255)    NOT NULL,
    "isActive"    BOOLEAN         NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: channelId UNIQUE + index
CREATE UNIQUE INDEX "manufacturer_channelId_key" ON "manufacturer"("channelId");
CREATE INDEX "manufacturer_channelId_idx" ON "manufacturer"("channelId");

-- AlterTable: charger_provisioning — add manufacturerId FK (nullable)
ALTER TABLE "charger_provisioning" ADD COLUMN "manufacturerId" INTEGER;

-- CreateIndex: charger_provisioning_manufacturerId_idx
CREATE INDEX "charger_provisioning_manufacturerId_idx" ON "charger_provisioning"("manufacturerId");

-- AddForeignKey: charger_provisioning.manufacturerId -> manufacturer.id
ALTER TABLE "charger_provisioning" ADD CONSTRAINT "charger_provisioning_manufacturerId_fkey"
    FOREIGN KEY ("manufacturerId") REFERENCES "manufacturer"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
