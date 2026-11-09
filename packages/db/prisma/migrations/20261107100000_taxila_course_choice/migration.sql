-- v1.4.1: "Choose a different Taxila course" — one remembered Taxila course per course offering.
-- Additive only: one new table; nothing existing changes.
-- CreateTable
CREATE TABLE "TaxilaCourseChoice" (
    "id" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "taxilaCourseId" INTEGER NOT NULL,
    "taxilaFullname" TEXT NOT NULL,
    "chosenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxilaCourseChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxilaCourseChoice_courseOfferingId_key" ON "TaxilaCourseChoice"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "TaxilaCourseChoice" ADD CONSTRAINT "TaxilaCourseChoice_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxilaCourseChoice" ADD CONSTRAINT "TaxilaCourseChoice_chosenById_fkey" FOREIGN KEY ("chosenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

