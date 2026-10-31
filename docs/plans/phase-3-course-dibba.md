# Course Dibba — Phase 3 plan: IC upload → preview → publish

Status: **approved 2026-10-01** (decisions in §9), building on branch `feature/course-dibba` on top of
the Phase 2 parsers. Spec: [course-dibba-schedule.md](../course-dibba-schedule.md) §3.1, §5.7, §7, §8,
§9; starter-kit BUILD-GUIDE "Phase 3". This document records WHY each decision was taken; the code and
tests record what was built. It went through two adversarial review rounds before approval (28 + 17
confirmed findings folded in; §10).

## 0. Decisions

**D1 — Upload is a Route Handler, not a server action (checklist item 3).**
`POST /api/ic/dibba-imports/upload`, modelled on
`apps/web/src/app/api/admin/corpus-imports/upload/route.ts` (the repo rule in
`docs/dev-handoff-audit.md`: Route Handler auth = explicit null/role checks, NOT `requireRole`, which
throws → 500). This deviates from BUILD-GUIDE's "server action converts" wording on purpose:
`serverActions.bodySizeLimit` is 10 MB (`apps/web/next.config.mjs`) and only a Route Handler owns both
the size ceiling and the error body. Size cap **8 MB** (`DIBBA_UPLOAD_MAX_BYTES`), deliberately ≤ nginx
`client_max_body_size 10m` (`deploy/nginx.conf`, and the bare-IP block in `deploy/ONE_HOUR_DEPLOY.md`)
so an oversize file gets OUR 413 JSON, not nginx's HTML page. The real files are 601 KB (.doc) / 298 KB
(.xlsx) / 70 KB (.docx). Row cap **5,000 parsed rows** (`DIBBA_MAX_ROWS`, ~5× the real 1,077), checked
after parse and before any write → 422 `too_many_rows` (the byte cap alone bounds neither DB rows nor the
preview). Validate by **extension** (`.doc`, `.docx`, `.xlsx`), never `file.type`: `validateAttachment`
has no `application/msword`, browsers send vendor/empty MIME types for legacy Office files, and Windows
reports CSV as `application/vnd.ms-excel`. Format/size validation runs BEFORE the term lookup — pure checks
before any DB round-trip.

**D2 — Persist on upload; the preview reads the database.** The handler converts → parses → writes ONE
`DibbaImport` (status DRAFT) + all `DibbaEntry` rows, then redirects to the preview. The schema is built for
it (`status @default(DRAFT)`, `rowCount`, `warnings String[]`, `publishedAt`); nothing stores the uploaded
file (the temp dir is removed in `finally`), so the CSV importer's re-parse-on-commit pattern cannot apply;
and Publish then becomes a pure status swap with no I/O inside the transaction (never do external work
inside a transaction — `docs/dev-handoff-audit.md`). Consequences: other DRAFTs for the term stay DRAFT
after a publish; re-uploading creates a new DRAFT (IC discards the old one). Parse metadata is NOT
persisted: `tableCount: number | null` (docx grid count; null for xlsx) and `sheetRowCount: number | null`
(xlsx rows read incl. dropped; null for doc/docx) are returned in the upload response and recorded in the
audit `after` payload only. `DibbaEntry.courseId` is frozen at upload (entries are write-once); the
preview's catalogue bucket is computed live (D10).

**D3 — One PUBLISHED import per term (checklist item 1): one transaction, serialized per term.**
There is no DB constraint for this (`@@index([termId, status])` only).
`publishDibbaImport(prisma, { importId, actorId })` (`packages/db/src/dibba-import/import-action.ts`) runs
ONE interactive `prisma.$transaction(…, { timeout: 15_000 })`:

1. `findUnique` the import (`termId, status, label, rowCount`); missing → throw `not_found`.
2. `SELECT id FROM "AcademicTerm" WHERE id = $termId FOR NO KEY UPDATE` — a row lock on the term held to
   commit. NO KEY UPDATE (not FOR UPDATE) because it conflicts with itself but not with the KEY SHARE lock
   the FK checker takes on the term row for every `DibbaImport` INSERT, so a 60 s upload transaction
   cannot stall a publish. Concurrent publishes (and discards, D9) for the same term serialize on it.
3. `findMany` the term's other PUBLISHED imports (`id, label`) — read BEFORE the update (afterwards nothing
   matches), inside the lock.
4. `updateMany({ where: { id: { in: ids } }, data: { status: 'SUPERSEDED' } })` — `publishedAt` is NOT
   cleared (historical stamp; the schema's detection queries rely on it).
5. `updateMany({ where: { id: importId, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt } })`;
   `count !== 1` → throw `not_draft` → everything rolls back.
6. `tx.auditLog.create({ actorId, action: 'dibba.import.publish', entity: 'DibbaImport', entityId,
before: { status, superseded: [{ id, label }] }, after: { status, termId, label, rowCount, publishedAt } })`
   — through `tx` so it is atomic (precedent `apps/web/src/app/ic/requests/new/actions.ts`; `audit()` uses
   the global client and would not be). `requestId` stays unset (it is a FK to HandoutRequest).

Why not a Postgres partial unique index (`… ON "DibbaImport"(termId) WHERE status = 'PUBLISHED'`): Prisma
cannot express it in `schema.prisma`, so the repo's migration-replay gate (`migrate diff --from-migrations …
--to-schema-datamodel` must print "No difference detected") would fail forever. The row lock closes the race
without that cost; a test proves two simultaneous publishes leave exactly one PUBLISHED, and a publish
racing a discard never deletes the live schedule.

**D4 — `AcademicTerm (year, term)` uniqueness (checklist item 2): added now.** `@@unique([year, term])`
as a second hand-authored additive migration (`20261001140000_academic_term_year_term_unique`, one
`CREATE UNIQUE INDEX`), authored with `prisma migrate diff --script`, applied locally with
`migrate deploy`, `prisma generate`, and replayed against `wilp_hmp_shadow` — exactly Phase 1's steps. Why
now: production has no Dibba tables yet (the Phase 1 migration is not deployed to RDS), so there is no
duplicate-row risk; later it would need a data audit first. The dev seed's term upsert was keyed on `name`
only and would P2002 on a renamed (2025, FIRST) term → replaced with a lookup by either key that never
writes to an existing row. App side: `term ∈ FIRST | SECOND | SUMMER` (the Semester form's vocabulary); a
clash on either unique → "A FIRST term for 2025 already exists: '2025-26 Sem 1'". `name @unique` stays.

**D5 — Create term is in Phase 3; edit term is Phase 4.** `seed.ts`: "Production terms are created
through the IC screen (Phase 3)"; the pilot DB has no terms, so without a create form the IC cannot upload
anything. Create upserts the 8 `SlotTiming` rows from `STANDARD_SLOTS` in the same transaction (times blank;
Phase 4 edits them) and writes `dibba.term.create`. Editing a term's name/dates is a convenience and lands
with the Phase 4 slots screen. Dates are `YYYY-MM-DD` parsed with the repo's `parseDateLocal` (no UTC
day-slip) and must satisfy end > start.

**D6 — Warnings shown in full, in a CLOSED set of families; Publish is the acknowledgement.** Parser
warnings are flat strings by design (spec §5.3). The substring markers live in ONE pure module,
`packages/db/src/dibba-warnings.ts` (client-safe, exported from the `@hmp/db` barrel like `dibba-slots`);
`parser.ts` and the xlsx reader compose their messages from those constants, so the classifier and the
emitters cannot drift. Families in match order (free-text-bearing messages first; `batch-cell` before
`merged-cell` because both contain "spans"):

| family           | marker                             | severity | counted in the acknowledgement |
| ---------------- | ---------------------------------- | -------- | ------------------------------ |
| no-code          | `no course code in`                | error    | yes                            |
| xlsx-dropped-row | `dropped: no readable course code` | error    | yes                            |
| xlsx-bad-slot    | `Exam Slot is not a number`        | confirm  | yes                            |
| batch-cell       | `batch cell spans`                 | confirm  | yes                            |
| merged-cell      | ` slot columns`                    | info     | no                             |
| overlap-cell     | `overlapping merged cells`         | error    | yes                            |
| header           | `disagrees with standard slot map` | confirm  | yes                            |
| inferred-slot    | `inferred from column position`    | confirm  | yes                            |
| nested-table     | `nested table detected`            | error    | yes                            |
| other            | —                                  | confirm  | yes                            |

Pinning: `parse_warnings.txt` pins the header family; literal assertions in `dibba-parser.test.ts` pin the
others (the merged-cell string got its own regression case in Phase 3 — it was previously only counted);
`dibba-warnings.test.ts` proves parser OUTPUT classifies by construction and that the real 2025 file is
exactly `{ header: 3, 'merged-cell': 2 }`. There is no `acknowledged` column (spec §7 "until IC
acknowledges"): the Publish confirmation lists the counted families and requires "I have reviewed the N
warnings that need confirmation" before the button enables — no schema change.

**D7 — `.xlsx` accepted (spec §3.1) with an observable mapping.** Additive
`parseDibbaXlsxDetailed(input) → { rows, warnings, sheetRowCount }`; `parseDibbaXlsx` is a wrapper
returning `.rows` (its 937-row golden is unchanged). Warnings: a non-blank row with no readable course code
(previously dropped silently — spec §5 says never drop silently) and a non-numeric Exam Slot (stored as
slot 0). Pure `xlsxRowToDibbaRow` (`packages/db/src/dibba-import/xlsx-to-rows.ts`): acadPlan →
programmeCode, `${degree} ${programme}` → programmeTitle, 'Backlog' → admitBatch null + isBacklogRow,
"New ADM" → isNewAdmission, `slotNo ?? 0` with day/session from `STANDARD_SLOTS` (null for 0/unknown),
Type from the Type TEXT only, in the Word parser's order (NOT OFFERED → NOT_OFFERED · BACKLOG/BKLG text →
BACKLOG · trailing-T → PROJECT ·
CORE → CORE · EL/ELECTIVE → ELECTIVE · else UNSPECIFIED), rawCell `CODE|TITLE`. Faculty sheet = Phase 4.

**D8 — Explicitly NOT in Phase 3:** slot times/exam dates, faculty sheet/CourseInstructor, term edit, My
Schedule, HOG/PC views, clash/coverage checks, notifications (no `schedule.*` templates — Phase 6), ICS,
editing entries (write-once), re-linking stored `courseId`, term deletion, the faculty-dashboard
`termClose` fix (Phase 5).

**D9 — Discard is a conditional delete in the same shape as publish.** One transaction: term locked FOR
UPDATE, `deleteMany({ where: { id, status: 'DRAFT' } })`, `count !== 1` → `not_draft`, audit
`dibba.import.discard` via `tx` with a `before` snapshot. Entries cascade.

**D10 — Catalogue match is one exported pure matcher, used at upload AND live on the preview.**
`matchCourseCodes(codes, courses)` (bitsCourseNumber first, then alternateCodes) + `findCatalogueCourses`
(one `findMany`, no per-row lookups; `Course.active` ignored). `createDibbaImport` uses them to set
`courseId`; the preview runs the same query over the import's distinct codes and derives the "not found"
bucket by set difference — so ADMIN adding a course under /admin/programmes is visible on the next page
load without a re-upload, while the stored `courseId` stays as written at upload.

**D11 — Server-action error contract.** `publishImportAction` / `discardDraftAction` /
`createTermAction` wrap the db core and return `{ error }` copy: `not_found` → "That import no longer
exists — refresh the page."; `not_draft` → "This import is no longer a draft (someone published or
discarded it) — refresh the page."; `term_exists` → the D4 message; Prisma `P2028` (transaction timeout) →
"Another publish for this term is in progress — try again in a moment."; anything else →
`console.error('[dibba.<action>]', err)` + "Could not <verb> right now — please retry."

## 1. Screens

### `/ic/dibba` — terms, imports, upload (IC; ADMIN bypasses through `requireRole`)

Server component, `dynamic = 'force-dynamic'`, first line `requireRole(await getSessionUser(),
RoleName.INSTRUCTION_CELL)`. Tab in `apps/web/src/app/ic/layout.tsx`: `{ href: '/ic/dibba', label: 'Course Dibba' }`.

- **Terms** card: Name · Year/Term · Dates · Published import (label + date / "none") · Drafts. Inline
  "Create term" form → `createTermAction`.
- **Upload a Dibba** card: term `<select>`, `label` prefilled by `deriveDibbaLabel(file.name)` (first
  `dd.mm.yyyy` or `dd-mm-yyyy` anywhere in the basename → "As on dd.mm.yyyy"; else the basename without
  extension; empty → "Dibba upload <YYYY-MM-DD>"; always sliced to 120; the server applies the same function
  when blank), file input `accept=".doc,.docx,.xlsx"`, `fetch` + `FormData` inside `useTransition`. On `ok`:
  `router.refresh()` THEN `router.push('/ic/dibba/<id>')` (refresh clears the client Router Cache so the
  list is fresh on Back). Errors show the server `error` code + `detail`; `converter_unavailable` reuses
  "LibreOffice not available to convert .doc — install libreoffice or set SOFFICE_BIN."
- **Imports** card (per term, newest first): Label · Source file · Format · Rows · Warnings (count; amber
  if any) · Status Badge (DRAFT `secondary` / PUBLISHED `success` / SUPERSEDED `outline`) · Published at ·
  Uploaded by (name) · Preview/View · Discard (DRAFT only; `window.confirm`; errors rendered inline).

### `/ic/dibba/[importId]` — preview + publish

Server component; `requireRole` first, `notFound()` for an unknown id. Reads the import, its entries
(`orderBy` programmeCode, admitBatch, slotNo, courseCode, id — deterministic), the term's current PUBLISHED
import, and the D10 catalogue query. No writes.

1. **Header** — term, label, source file/format, uploaded by/at, status badge.
2. **Counts strip** — `Stat` tiles (copied from `admin/import/page.tsx`; values through
   `Intl.NumberFormat('en-IN')` so `1,077` renders as such): Rows · Unique course codes · Programmes · Rows
   with a student count · Rows with a class-time hint · Codes not in catalogue (2025: 1,077 · 638 · 41 ·
   767 · 22 · see 4). All DibbaEntry aggregates.
3. **Warnings panel** (`data-testid="dibba-warnings"`) — full text, monospace, never truncated (a
   deliberate departure from `/admin/corpus-imports`, which shows only the first warning), grouped per D6
   via `groupDibbaWarnings`, each `<li data-kind>`, one explanatory line per family. For the 2025 file:
   "Header disagreements (3)" (the HB28/HB59 lines) and "Merged-cell notes (2)" (the two 18BT/18ET lines).
4. **Not in HMP catalogue** (spec §5.7; live per D10): (a) "cannot exist in the catalogue by format" —
   trailing-T and 5-letter-prefix codes that the strict `normalizeBitsCourseNumber` rejects by design (20
   distinct / 29 rows on the 2025 file; listed in full); (b) "not found in the catalogue" — headline count,
   first 25 codes (row count + first title), remainder in a collapsed `<details>` capped at 500. On the dev
   seed, CI and the pilot the catalogue is nearly empty, so ~618 of 638 codes are unlinked today — catalogue
   population for ADMIN, not an import error.
5. **Programme tables** — one `<details>` per programme (41): Batch · New/Backlog · Students · Slot ·
   Code (mono; "not in catalogue" pill from the live match) · Title · Type · Class-time hint; `rawCell` in
   the code cell's tooltip. No pagination.
6. **Publish panel** (DRAFT only), the inline count-then-commit idiom of
   `admin/corpus-imports/bulk-approve-widget.tsx`: "Publish '<label>' as the schedule for <term> (1,077
   rows)"; if a PUBLISHED import exists: "'<label>' (published <date>) will be marked SUPERSEDED."; the D6
   checkbox; Publish → `publishImportAction` → `router.refresh()`; `{ error }` inline.

## 2. Code pieces

**packages/db** (server-only sub-barrel `@hmp/db/src/dibba-import`): `dibba-warnings.ts` (markers,
`classifyDibbaWarning`, `groupDibbaWarnings`, `countAcknowledgeableWarnings`, and `capDibbaWarnings` —
the byte and row caps do not bound warnings, so `createDibbaImport` caps them once: 500 chars each, 200
per family, plus one summary line per overflowing family composed from that family's marker so it keeps
its severity; barrel-exported);
`dibba-import/parser.ts` (warning strings composed from the markers — byte-identical);
`dibba-import/xlsx.ts` (`parseDibbaXlsxDetailed`); `dibba-import/xlsx-to-rows.ts`;
`dibba-import/import-action.ts` (`createDibbaImport` — entries via `createMany` in chunks of 500 inside
`$transaction(fn, { timeout: 60_000, maxWait: 5_000 })`, the repo's first explicit transaction options;
`publishDibbaImport`; `discardDibbaImport`; `createAcademicTerm`; `matchCourseCodes`;
`findCatalogueCourses`; `DibbaError`); schema `@@unique([year, term])` + migration + seed guard.
**apps/web**: `api/ic/dibba-imports/upload/route.ts`; `ic/dibba/upload-validation.ts` (pure, shared by the
client form and the route); `ic/dibba/page.tsx` + `actions.ts` (`createTermAction`, `discardDraftAction`)

- forms; `ic/dibba/[importId]/page.tsx` + `actions.ts` (`publishImportAction`) + panels; `ic/layout.tsx`
  tab; `e2e/ic-dibba.spec.ts`.

## 3. Upload handler contract — `POST /api/ic/dibba-imports/upload`

FormData: `file`, `termId` (cuid), `label` (optional ≤120; blank → derived). Every check lives in the
handler (middleware excludes `/api`). Order: 1 Origin/Host mismatch → 403 `bad_origin` · 2 no session → 401;
`!hasRole(me, INSTRUCTION_CELL)` → 403 (`hasRole` carries the ADMIN bypass and does not throw) · 3
`rateLimit('dibba-upload:<id>', RATE_LIMITS.upload)` → 429 (this path spawns LibreOffice) · 4 bad
multipart / no file / bad `termId` → 400 · 5 `validateDibbaUpload` → 415 / 413 / 400 `empty_file` (pure,
before any DB) · 6 term lookup → 404 · 7 `mkdtemp('hmp-dibba-')`; only `.doc` touches disk as
`join(work, randomUUID() + ext)` with the VALIDATED ext, never `file.name`; `sourceFilename =
basename(file.name).slice(0, 255)`; `.doc` → `ensureDocxFormat` → `parseDibbaDocx({ path })` with
`SofficeError` `missing-binary` → 503 `converter_unavailable`, `timeout` → 504, `conversion-failed` → 422
(stderr logged server-side only); `.docx` → `parseDibbaDocx({ buffer })`; `.xlsx` →
`parseDibbaXlsxDetailed({ buffer })` → mapper; other parser throws → 422 `parse_failed` with a safe detail;
`rows === 0` → 422 `no_rows`; `> DIBBA_MAX_ROWS` → 422 `too_many_rows` — nothing written · 8
`createDibbaImport` (the only DB write) · 9 `audit('dibba.import.upload')` in its own try/catch AFTER the
write (an audit failure must not 500 a successful import and invite a duplicate) · 10 200 `{ ok, importId,
rowCount, warningCount, unknownCodeCount, tableCount, sheetRowCount }`; unexpected throw → 500; `finally`
is total and non-throwing (`ensured?.cleanup().catch()`, `rm(work).catch()`). A timing log line
(`convert/parse/write ms`) makes EC2 conversion time visible against the 30 s soffice SIGKILL.

## 4. When Phase 3 touches the database

| Step                              | Writes                                                                                   | Transaction                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Migration (D4), local dev DB only | `CREATE UNIQUE INDEX "AcademicTerm_year_term_key"`                                       | `migrate deploy` + `prisma generate` + replay vs `wilp_hmp_shadow`; production only when the feature deploys, after an RDS snapshot |
| Create term                       | 1 `AcademicTerm` + 8 `SlotTiming` + 1 `AuditLog`                                         | one `$transaction`                                                                                                                  |
| Upload                            | 1 `DibbaImport` (DRAFT) + N `DibbaEntry` (1,077 for 2025); then 1 `AuditLog`             | one `$transaction` (chunked `createMany`); audit after commit                                                                       |
| Preview page                      | none (reads incl. the live catalogue match)                                              | —                                                                                                                                   |
| Publish                           | superseded PUBLISHED → SUPERSEDED, this DRAFT → PUBLISHED (+`publishedAt`), 1 `AuditLog` | one `$transaction`, term row locked FOR NO KEY UPDATE                                                                               |
| Discard draft                     | delete 1 DRAFT `DibbaImport` (entries cascade), 1 `AuditLog`                             | one `$transaction`, term row locked; refuses non-DRAFT                                                                              |

Nothing writes to Course, Semester, User, notifications or S3. EC2/RDS untouched until a deliberate deploy.

## 5. Tests

- **packages/db** — DB integration cases live in `corpus-import-action.test.ts` as a sibling `describe`
  (one PrismaClient per test file; reuses its client and probe; own DB-only skip reason; loud per-test
  `ctx.skip()`; per-run sentinel term/user/courses purged in `beforeAll`): create from the committed `.docx`
  → 1,077 entries + 5 warnings; `matchCourseCodes` by bitsCourseNumber and by alternateCodes; publish A;
  publish B → A SUPERSEDED (publishedAt kept), audit `before.superseded = [A]` with `actorId`; two
  concurrent publishes → exactly one PUBLISHED; publish ∥ discard → the live schedule survives; non-DRAFT
  publish/discard → `not_draft`; create term seeds 8 slots + audit; same (year, term) twice → `term_exists`
  and, bypassing the pre-check, P2002. `dibba-warnings.test.ts`, `dibba-xlsx-to-rows.test.ts`, and the
  merged-cell regression case in `dibba-parser.test.ts` are pure.
- **apps/web** — `upload-validation.test.ts` (boundaries, label derivation); a Route Handler test with
  factory mocks (`@hmp/db` via `importOriginal` spread so `RoleName` survives, `@hmp/auth`, rate-limit,
  audit, `ensureDocxFormat` throwing `SofficeError('missing-binary')`) asserting 401/403/415/413/400, 404
  and the 503 mapping with no DB and no LibreOffice; `e2e/ic-dibba.spec.ts` (login `ic@hmp.local`, create a
  per-run term — year `9000 + ts % 1000`, the e2e DB already holds (2025, FIRST) — upload the committed
  `.docx`, expect "1,077" and 3 + 2 warnings, tick, publish → PUBLISHED; cleanup imports-then-term in
  `try/finally`).
- Manual acceptance (BUILD-GUIDE): `pnpm dev` → `ic@hmp.local` → upload the real `.doc` → 1,077 rows,
  3 + 2 warnings → Publish.

## 6. Commits

1. `feat(db)` warning markers + classifier, xlsx detail reader + mapper, import persistence,
   publish/discard/term core, D4 migration + seed guard, this document.
2. `feat(web)` IC Dibba upload Route Handler + upload validation (+ route test).
3. `feat(web)` `/ic/dibba` — terms (create), upload form, imports list; IC tab.
4. `feat(web)` `/ic/dibba/[importId]` — preview + publish.
5. `test(e2e)` IC Dibba upload → preview → publish; `docs(deploy)` record `soffice --version` on the pilot.
   Each: prettier → eslint → tsc → full db + web suites; then one `pnpm --filter @hmp/web build`
   (mammoth/exceljs must stay out of the client bundle).

## 7. Converter risk — closed

The committed `.docx` fixture was produced by LibreOffice 24.2; EC2 installs an unpinned `apt libreoffice`
and no doc records its version. On 2026-10-01 the raw `.doc` was converted locally through the same
`ensureDocxFormat` path with LibreOffice 26.8: **1,077 / 638 / 41, all 1,077 rows byte-identical to the
24.2 fixture's parse, all 5 warnings identical** (conversion 9.2 s; parse 0.5 s). No `converterVersion`
column is needed. Remaining ops notes: CI has no LibreOffice (`.doc` is covered by the local probe-skipped
golden plus the mocked 503 route test); conversion runs inside the request (precedent: corpus upload) —
the 30 s soffice SIGKILL and PM2's 900 MB restart are the limits to watch; JWT roles are fixed at sign-in,
so a newly granted INSTRUCTION_CELL user must log out/in before `/ic/dibba` appears.

## 8. Checklist items from Phase 1/2 reviews — how each is honoured

1. One PUBLISHED per term, swapped in a single transaction → D3 (+ D9 for the discard race), tested.
2. `AcademicTerm (year, term)` uniqueness → D4, migration applied + replayed, seed guarded, tested.
3. Upload via a Route Handler (not a server action) with a size cap and extension-based validation → D1, §3.

## 9. Decisions recorded (2026-10-01)

D4 migration now · term create in Phase 3, edit in Phase 4 · e2e in commit 5 with the committed `.docx`
(no LibreOffice in CI) · tab label "Course Dibba" · this plan committed in commit 1 so the PR shows why.

## 10. Review provenance

v1 → v2: 28 confirmed findings (e.g. a preview tile with no persisted source; superseded ids must be read
inside the transaction and the audit needs `actorId`; discard must be a conditional delete; the xlsx path
dropped rows silently and lacked a null-slot rule; `describe.skipIf` evaluates before `beforeAll`; the
`finally` cleanup threw on every non-`.doc` path; temp filename from a UUID, never `file.name`; row cap;
label default on the server; term-date validation; create-term audit; a mis-cited flake-tracker line).
v2 → v3: 17 more (format/size validation before the term lookup; the merged-cell wording was pinned by no
test; `ctx.skip()` takes no argument on Vitest 2.1.9; DB tests folded into the existing client file; closed
warning taxonomy incl. `overlap-cell` and the xlsx families; the action error contract; the live catalogue
match; the seed guard; `NumberFormat` for counts; per-run sentinel keys).
