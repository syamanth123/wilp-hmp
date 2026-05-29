-- Prompt 11b — course-code reconciliation. Pure additive on Course; the four
-- existing references (CourseOffering.courseId, etc.) point at Course.id and
-- are unaffected. The seed update in this PR rewrites the seeded rows to
-- canonical BITS codes after this migration applies.

-- Step 1 — add nullable columns
ALTER TABLE "Course" ADD COLUMN "bitsCourseNumber" TEXT;
ALTER TABLE "Course" ADD COLUMN "alternateCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Step 2 — backfill bitsCourseNumber from the existing `code` value so the
-- NOT NULL constraint in Step 3 can land on existing rows. The seed will
-- replace these with canonical, normalized BITS codes immediately after.
UPDATE "Course" SET "bitsCourseNumber" = "code" WHERE "bitsCourseNumber" IS NULL;

-- Step 3 — enforce NOT NULL + UNIQUE on bitsCourseNumber
ALTER TABLE "Course" ALTER COLUMN "bitsCourseNumber" SET NOT NULL;
CREATE UNIQUE INDEX "Course_bitsCourseNumber_key" ON "Course"("bitsCourseNumber");

-- Step 4 — relax credits to optional (matches the 11a optional-field discipline:
-- real handouts often leave Credit Units blank; AEL ZG631 is the documented example)
ALTER TABLE "Course" ALTER COLUMN "credits" DROP NOT NULL;
ALTER TABLE "Course" ALTER COLUMN "credits" DROP DEFAULT;
