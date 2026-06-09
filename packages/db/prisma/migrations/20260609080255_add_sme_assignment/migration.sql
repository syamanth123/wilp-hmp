-- AlterEnum
ALTER TYPE "ApprovalStage" ADD VALUE 'SME_REVIEW';

-- AlterEnum
ALTER TYPE "HandoutStatus" ADD VALUE 'SME_REVIEW';

-- CreateTable
CREATE TABLE "SmeAssignment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "smeUserId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmeAssignment_requestId_key" ON "SmeAssignment"("requestId");

-- CreateIndex
CREATE INDEX "SmeAssignment_smeUserId_idx" ON "SmeAssignment"("smeUserId");

-- AddForeignKey
ALTER TABLE "SmeAssignment" ADD CONSTRAINT "SmeAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HandoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAssignment" ADD CONSTRAINT "SmeAssignment_smeUserId_fkey" FOREIGN KEY ("smeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAssignment" ADD CONSTRAINT "SmeAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
