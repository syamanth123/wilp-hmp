-- CreateEnum
CREATE TYPE "SmeNominationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'COMPLETED');

-- CreateTable
CREATE TABLE "SmeNomination" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "smeUserId" TEXT NOT NULL,
    "nominatedById" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "notes" TEXT,
    "status" "SmeNominationStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmeNomination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmeNomination_requestId_idx" ON "SmeNomination"("requestId");

-- CreateIndex
CREATE INDEX "SmeNomination_smeUserId_status_idx" ON "SmeNomination"("smeUserId", "status");

-- AddForeignKey
ALTER TABLE "SmeNomination" ADD CONSTRAINT "SmeNomination_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HandoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeNomination" ADD CONSTRAINT "SmeNomination_smeUserId_fkey" FOREIGN KEY ("smeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeNomination" ADD CONSTRAINT "SmeNomination_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
