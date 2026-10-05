-- Course Dibba Phase 3: one real semester = one AcademicTerm — @@unique([year, term]).
-- Purely additive: one unique index on a table with no production rows yet (the Phase 1
-- migration is not deployed to RDS), so it cannot fail on existing data. No existing
-- table, column or row is altered. Generated with `prisma migrate diff --script`
-- (migrate dev is interactive-only here — see docs/dev-handoff-audit.md "Authoring
-- migrations"), applied via `prisma migrate deploy`, replayed against wilp_hmp_shadow.

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_year_term_key" ON "AcademicTerm"("year", "term");

