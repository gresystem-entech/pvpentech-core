-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'deferred';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "userId" INTEGER;

-- CreateIndex
CREATE INDEX "transaction_userId_idx" ON "transaction"("userId");

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
