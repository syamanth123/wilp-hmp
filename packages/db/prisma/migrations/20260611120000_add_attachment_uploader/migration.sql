-- Prompt 16: handout attachments. Adds the uploader FK + a unique S3 key + a
-- requestId index to the (empty, scaffolded) Attachment table. Hand-authored
-- to match Prisma's generated SQL/naming (migrate dev is interactive-only in
-- this environment); applied via `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "uploaderId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_s3Key_key" ON "Attachment"("s3Key");

-- CreateIndex
CREATE INDEX "Attachment_requestId_idx" ON "Attachment"("requestId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
