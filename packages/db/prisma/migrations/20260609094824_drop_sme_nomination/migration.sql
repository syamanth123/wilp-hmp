/*
  Warnings:

  - You are about to drop the `SmeNomination` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SmeNomination" DROP CONSTRAINT "SmeNomination_nominatedById_fkey";

-- DropForeignKey
ALTER TABLE "SmeNomination" DROP CONSTRAINT "SmeNomination_requestId_fkey";

-- DropForeignKey
ALTER TABLE "SmeNomination" DROP CONSTRAINT "SmeNomination_smeUserId_fkey";

-- DropTable
DROP TABLE "SmeNomination";

-- DropEnum
DROP TYPE "SmeNominationStatus";
