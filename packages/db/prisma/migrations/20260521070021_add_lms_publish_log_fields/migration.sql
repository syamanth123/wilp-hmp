-- CreateEnum
CREATE TYPE "LmsPublishMode" AS ENUM ('HTTP', 'EXPORT', 'MANUALLY_CONFIRMED');

-- AlterTable
ALTER TABLE "LmsPublishLog" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "mode" "LmsPublishMode",
ADD COLUMN     "s3Key" TEXT;
