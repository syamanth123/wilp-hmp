-- v1.4.0 (docs/plans/departments.md). Purely additive: the four departments (decision H3; names are
-- editable later) and a department per Course Dibba programme code. The inserts skip codes that exist.

-- CreateTable
CREATE TABLE "DibbaProgrammeDepartment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DibbaProgrammeDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DibbaProgrammeDepartment_code_key" ON "DibbaProgrammeDepartment"("code");

-- CreateIndex
CREATE INDEX "DibbaProgrammeDepartment_departmentId_idx" ON "DibbaProgrammeDepartment"("departmentId");

-- AddForeignKey
ALTER TABLE "DibbaProgrammeDepartment" ADD CONSTRAINT "DibbaProgrammeDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: the four departments (the seed upserts the same codes, so dev and server agree).
INSERT INTO "Department" ("id", "code", "name", "active", "createdAt", "updatedAt") VALUES
  ('dept_mba',  'MBA',  'MBA / Management', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dept_core', 'CORE', 'Core Engineering', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dept_csis', 'CSIS', 'CSIS',             true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dept_eee',  'EEE',  'EEE',              true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
