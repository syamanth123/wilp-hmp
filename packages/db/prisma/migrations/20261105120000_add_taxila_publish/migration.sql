-- v1.3.0 (docs/plans/taxila-publish.md §F). Purely additive: one enum value and three new tables;
-- nothing existing is altered, so a rollback to v1.2.0 needs no restore. Generated with
-- `prisma migrate diff --script` and applied with `prisma migrate deploy`.

-- AlterEnum
ALTER TYPE "LmsPublishMode" ADD VALUE 'TAXILA_FOLDER';

-- CreateTable
CREATE TABLE "DibbaProgrammeCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DibbaProgrammeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxilaPublishRun" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "semesterCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TaxilaPublishRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxilaPublishItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "step" TEXT,
    "message" TEXT,
    "fileName" TEXT,
    "courseFullname" TEXT,
    "taxilaCourseId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxilaPublishItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DibbaProgrammeCode_code_key" ON "DibbaProgrammeCode"("code");

-- CreateIndex
CREATE INDEX "DibbaProgrammeCode_programmeId_idx" ON "DibbaProgrammeCode"("programmeId");

-- CreateIndex
CREATE INDEX "TaxilaPublishRun_createdById_createdAt_idx" ON "TaxilaPublishRun"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "TaxilaPublishItem_runId_position_idx" ON "TaxilaPublishItem"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaxilaPublishItem_runId_requestId_key" ON "TaxilaPublishItem"("runId", "requestId");

-- AddForeignKey
ALTER TABLE "DibbaProgrammeCode" ADD CONSTRAINT "DibbaProgrammeCode_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxilaPublishRun" ADD CONSTRAINT "TaxilaPublishRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxilaPublishItem" ADD CONSTRAINT "TaxilaPublishItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TaxilaPublishRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxilaPublishItem" ADD CONSTRAINT "TaxilaPublishItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HandoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

