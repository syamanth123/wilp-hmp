-- Drop the dead `User.deletedAt` column (Prompt 18). It was scaffolded for a
-- soft-delete pattern that was instead implemented via `User.active` (the live,
-- fully-wired mechanism: auth rejects inactive users, and every roster/picker/
-- recipient query filters active=true). `deletedAt` was never read or written
-- anywhere — keeping two soft-delete signals invites a two-source-of-truth bug.
--
-- PRE-FLIGHT CHECK (run before applying):
--   SELECT COUNT(*) FROM "User" WHERE "deletedAt" IS NOT NULL;
-- Must return 0. If non-zero, STOP and investigate — some code set deletedAt and
-- those rows must be reconciled (e.g. set active=false) before dropping the
-- column. Verified 0 in dev on 2026-06-11 before authoring this migration.

ALTER TABLE "User" DROP COLUMN "deletedAt";
