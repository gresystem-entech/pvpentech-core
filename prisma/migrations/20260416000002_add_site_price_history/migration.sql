-- CreateTable
CREATE TABLE "site_price_history" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "previousPrice" DECIMAL(10,2) NOT NULL,
    "newPrice" DECIMAL(10,2) NOT NULL,
    "changedBy" VARCHAR(150) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_price_history_siteId_idx" ON "site_price_history"("siteId");

-- AddForeignKey
ALTER TABLE "site_price_history" ADD CONSTRAINT "site_price_history_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "charging_site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
