-- Course Dibba Phase 1: 4 enums + 6 new term-wide tables (AcademicTerm,
-- DibbaImport, DibbaEntry, SlotTiming, SlotExamDate, CourseInstructor).
-- Purely additive: no existing table, column or row is altered; User and Course
-- only gain Prisma back-relation fields (no SQL). No backfill, no data risk.
-- Generated with `prisma migrate diff --script` (migrate dev is interactive-only
-- here — see docs/dev-handoff-audit.md "Authoring migrations"), applied via
-- `prisma migrate deploy`. FK onDelete choices are justified in schema.prisma.

-- CreateEnum
CREATE TYPE "DibbaImportStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DibbaCourseType" AS ENUM ('CORE', 'ELECTIVE', 'PROJECT', 'BACKLOG', 'NOT_OFFERED', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "ExamKind" AS ENUM ('MID_SEM', 'COMPREHENSIVE', 'MAKEUP');

-- CreateEnum
CREATE TYPE "InstructorSource" AS ENUM ('HMP_ASSIGNMENT', 'DIBBA_SHEET', 'MANUAL');

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DibbaImport" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "status" "DibbaImportStatus" NOT NULL DEFAULT 'DRAFT',
    "rowCount" INTEGER NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DibbaImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DibbaEntry" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "programmeCode" TEXT NOT NULL,
    "programmeTitle" TEXT NOT NULL,
    "admitBatch" TEXT,
    "isNewAdmission" BOOLEAN NOT NULL DEFAULT false,
    "isBacklogRow" BOOLEAN NOT NULL DEFAULT false,
    "studentCount" INTEGER,
    "slotNo" INTEGER NOT NULL,
    "slotDay" TEXT,
    "slotSession" TEXT,
    "courseCode" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "courseType" "DibbaCourseType" NOT NULL DEFAULT 'UNSPECIFIED',
    "erpCourseId" TEXT,
    "classTimeHint" TEXT,
    "remarks" TEXT,
    "rawCell" TEXT NOT NULL,
    "courseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DibbaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotTiming" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "slotNo" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotTiming_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotExamDate" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "slotNo" INTEGER NOT NULL,
    "kind" "ExamKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotExamDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseInstructor" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "source" "InstructorSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_name_key" ON "AcademicTerm"("name");

-- CreateIndex
CREATE INDEX "DibbaImport_termId_status_idx" ON "DibbaImport"("termId", "status");

-- CreateIndex
CREATE INDEX "DibbaEntry_importId_courseCode_idx" ON "DibbaEntry"("importId", "courseCode");

-- CreateIndex
CREATE INDEX "DibbaEntry_importId_programmeCode_idx" ON "DibbaEntry"("importId", "programmeCode");

-- CreateIndex
CREATE INDEX "DibbaEntry_courseId_idx" ON "DibbaEntry"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "SlotTiming_termId_slotNo_key" ON "SlotTiming"("termId", "slotNo");

-- CreateIndex
CREATE UNIQUE INDEX "SlotExamDate_termId_slotNo_kind_key" ON "SlotExamDate"("termId", "slotNo", "kind");

-- CreateIndex
CREATE INDEX "CourseInstructor_userId_termId_idx" ON "CourseInstructor"("userId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseInstructor_termId_courseCode_userId_key" ON "CourseInstructor"("termId", "courseCode", "userId");

-- AddForeignKey
ALTER TABLE "DibbaImport" ADD CONSTRAINT "DibbaImport_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DibbaImport" ADD CONSTRAINT "DibbaImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DibbaEntry" ADD CONSTRAINT "DibbaEntry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DibbaImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DibbaEntry" ADD CONSTRAINT "DibbaEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotTiming" ADD CONSTRAINT "SlotTiming_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotExamDate" ADD CONSTRAINT "SlotExamDate_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

