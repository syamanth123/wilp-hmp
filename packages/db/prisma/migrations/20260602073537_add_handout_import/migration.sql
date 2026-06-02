-- CreateEnum
CREATE TYPE "CorpusExtractionMethod" AS ENUM ('MAMMOTH_STRUCTURED', 'TEXT_FALLBACK', 'FAILED', 'SKIPPED_MODULE', 'SKIPPED_SIZE', 'SKIPPED_FORMAT');

-- CreateTable
CREATE TABLE "HandoutImport" (
    "id" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceFileBytes" INTEGER NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3) NOT NULL,
    "bitsCourseNumber" TEXT,
    "alternateCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data" JSONB,
    "parseWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parseErrors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extractionMethod" "CorpusExtractionMethod" NOT NULL,
    "approvedForReuse" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoutImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandoutImport_sourceFile_key" ON "HandoutImport"("sourceFile");

-- CreateIndex
CREATE INDEX "HandoutImport_bitsCourseNumber_idx" ON "HandoutImport"("bitsCourseNumber");

-- CreateIndex
CREATE INDEX "HandoutImport_approvedForReuse_idx" ON "HandoutImport"("approvedForReuse");

-- CreateIndex
CREATE INDEX "HandoutImport_extractionMethod_idx" ON "HandoutImport"("extractionMethod");

-- AddForeignKey
ALTER TABLE "HandoutImport" ADD CONSTRAINT "HandoutImport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
