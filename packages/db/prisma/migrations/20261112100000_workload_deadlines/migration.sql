-- v1.4.2: due dates, escalation, away / back-up, settings, replies, auto-publish.
-- Additive only: new tables, new nullable or defaulted columns. The only data written is the new
-- HandoutRequest.statusChangedAt, filled from each request's own history.
-- CreateEnum
CREATE TYPE "EmailMode" AS ENUM ('INSTANT', 'DIGEST');

-- CreateEnum
CREATE TYPE "DeadlineStage" AS ENUM ('ALLOCATION', 'DRAFT', 'SME_REVIEW', 'PC_REVIEW', 'HOG_FINAL', 'PUBLISH');

-- AlterTable
ALTER TABLE "HandoutRequest" ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "WorkflowConfig" ADD COLUMN     "autoPublish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueAllocationDays" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN     "dueDraftDays" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN     "dueHogFinalDays" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "duePcDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "duePublishDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "dueSmeDays" INTEGER NOT NULL DEFAULT 17,
ADD COLUMN     "escalationDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "escalationOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smeReviewSla" INTEGER NOT NULL DEFAULT 72;

-- AlterTable
ALTER TABLE "TaxilaPublishRun" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailMode" "EmailMode" NOT NULL DEFAULT 'INSTANT',
    "weeklySummary" BOOLEAN NOT NULL DEFAULT true,
    "awayFrom" TIMESTAMP(3),
    "awayUntil" TIMESTAMP(3),
    "backupUserId" TEXT,
    "lastUsed" JSONB,
    "calendarTokenHash" TEXT,
    "calendarTokenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestDeadline" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stage" "DeadlineStage" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "setById" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stage" "DeadlineStage" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "level" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "ScheduledRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_calendarTokenHash_key" ON "UserPreference"("calendarTokenHash");

-- CreateIndex
CREATE INDEX "UserPreference_backupUserId_idx" ON "UserPreference"("backupUserId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestDeadline_requestId_stage_key" ON "RequestDeadline"("requestId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationStep_requestId_stage_dueAt_level_key" ON "EscalationStep"("requestId", "stage", "dueAt", "level");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledRun_job_periodKey_key" ON "ScheduledRun"("job", "periodKey");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDeadline" ADD CONSTRAINT "RequestDeadline_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HandoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDeadline" ADD CONSTRAINT "RequestDeadline_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationStep" ADD CONSTRAINT "EscalationStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HandoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: when each request entered its current status = its latest status change in the audit log,
-- else when it was created.
UPDATE "HandoutRequest" r
SET "statusChangedAt" = COALESCE(
  (SELECT MAX(a."createdAt") FROM "AuditLog" a
    WHERE a."requestId" = r."id" AND a."action" LIKE 'handout.transition.%'),
  r."createdAt"
)
WHERE r."statusChangedAt" IS NULL;
