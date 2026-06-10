# Handout Management Portal (HMP)

The Handout Management Portal automates the end-to-end lifecycle of course handouts at BITS Pilani's Work Integrated Learning Programmes (WILP). It moves the request → allocate → assign → edit → review → approve → publish → archive flow off email and spreadsheets, into a single workspace shared by the Instruction Cell, Programme Committees, Heads of Group, and faculty.

---

## Milestone status

Status reflects what the code does today, verified against CI on every push. ✅ = done. 🟡 = partially built; the path works but has named caveats. 🔴 = not in the repo.

| #      | Status | Scope                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1** | ✅     | Foundations                | NextAuth v5 (credentials), 29-model Prisma schema, three-layer RBAC (middleware → server-action → workflow guards). CI green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **M2** | ✅     | Admin module               | Eight admin routes — users, programmes, roles, audit log, CSV import, notification templates, workflow config, AI metrics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **M3** | ✅     | Workflow engine + IC       | XState lifecycle (11 states / 12 events) wired through a single `transition()` orchestrator. IC create is race-safe: optimistic P2002 retry (commit `3b2e834`), proven by [concurrent.test.ts](apps/web/src/app/ic/requests/new/__tests__/concurrent.test.ts) — 10 simultaneous creates produce 10 unique sequential refNos.                                                                                                                                                                                                                                                                                                                                 |
| **M4** | ✅     | HOG + PC                   | Faculty allocation with the off-campus / adjunct / guest cap enforced _inside_ the transaction; PC confirm + review + rework; E2E covers IC→HOG→PC chain end-to-end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **M5** | ✅     | Faculty + Editor           | TipTap editor, accept → start-editing → save → submit. E2E exercises the full flow including version save and submit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **M6** | 🟡     | Publish / Archive          | Status transitions through PUBLISHED → ARCHIVED work and write `LmsPublishLog`. **`publishToLms()` is a pure stub** — [packages/integrations/src/taxila.ts](packages/integrations/src/taxila.ts) returns simulated success with no HTTP call. Real Taxila client is Phase 3.                                                                                                                                                                                                                                                                                                                                                                                 |
| **M7** | ✅     | Notifications + Dashboards | In-portal `Notification` model + bell + SSE stream + email via Nodemailer SMTP. **BullMQ background workers** ([`@hmp/queue`](packages/queue) + [`apps/web/src/workers`](apps/web/src/workers)) move notification + on-submit-AI work off the request cycle when `WORKERS_ENABLED=true` (synchronous fallback otherwise); admin observability at `/admin/queues` with worker heartbeat + failed-job retry/delete. SLA reminder cron at [`/api/cron/reminders`](apps/web/src/app/api/cron/reminders/route.ts) stays synchronous (returns a count the caller reports). Dashboards: SLA widgets + AI metrics ship; cost rollup blocked on schema work (see M8). |
| **M8** | 🟡     | AI layer                   | Recommender, quality report, and handout-draft generator all work end-to-end. **All three gracefully degrade to stubs when `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are absent** — the UI surfaces a "not configured" / "template stub" message. AI usage dashboard renders real per-day buckets; **cost dashboard is blocked** on a schema migration to promote `promptTokens` / `completionTokens` from the JSON payload to indexed columns (see in-page comment at [ai-metrics/page.tsx:208-211](apps/web/src/app/admin/ai-metrics/page.tsx)).                                                                                                              |
| **M9** | 🟡     | Tests + Docs + Polish      | 37 unit tests + 13 Playwright E2E specs both run in CI on every push. **E2E runs against the production build (`next start`)**, not dev mode (see commit `279d48c` for why). Coverage gaps: the rework loop (`SUBMITTED → REWORK_REQUESTED → SUBMITTED`), multi-version diff edge cases, SSE reconnection, concurrent-edit conflicts.                                                                                                                                                                                                                                                                                                                        |

Honesty rule: if the code doesn't have it, the table doesn't claim it. The full per-area breakdown — including everything outside the M1–M9 milestone framing (SSO, file uploads, SME flow, backups, security headers, etc.) — lives in [docs/rfp-traceability.md](docs/rfp-traceability.md).

---

## Quick start

### Prerequisites

- Node 20+
- pnpm 9+
- Docker + Docker Compose (for Postgres / Redis / MinIO / Mailhog), OR a locally-running Postgres 16+ if you prefer
- `openssl` (for generating the NextAuth + cron secrets)

### Steps

```bash
# 1. Clone + install
git clone <your-fork-url> wilp-hmp
cd wilp-hmp
pnpm install

# 2. Environment
cp .env.example .env
# Replace the placeholder secrets with real ones:
echo "NEXTAUTH_SECRET=\"$(openssl rand -base64 32)\"" >> .env
echo "CRON_SECRET=\"$(openssl rand -base64 32)\""    >> .env
# Edit .env to point DATABASE_URL at your Postgres (default expects
# postgresql://hmp:hmp@localhost:5432/hmp).

# 3. Local services (Postgres + Redis + MinIO + Mailhog)
docker compose -f infra/docker-compose.yml up -d

# 4. Schema + seed
pnpm --filter @hmp/db generate
pnpm --filter @hmp/db push   # see "DB migration story" below
pnpm db:seed

# 5. Run
pnpm dev
```

The app comes up at **http://localhost:3000**. Mailhog UI at **:8025**, MinIO console at **:9001** (`hmpaccess` / `hmpsecret123`). Prisma Studio: `pnpm db:studio`.

### DB migration story

Migrations now live under [`packages/db/prisma/migrations/`](packages/db/prisma/migrations). The first migration (`*_init`) captures the full 29-model baseline; subsequent migrations are incremental diffs (e.g. `*_add_sme_nomination`).

- **Local dev (new schema change)**: `pnpm --filter @hmp/db exec prisma migrate dev --name <slug>` generates the migration file, applies it, and regenerates the client.
- **CI**: still uses `pnpm --filter @hmp/db push` against a fresh service container each run — faster than replaying every historical migration when the schema is small.
- **Production**: `pnpm --filter @hmp/db exec prisma migrate deploy`. Never `db push` or `migrate dev` in production. Full lifecycle table in [docs/deployment-runbook.md](docs/deployment-runbook.md#migration-lifecycle-dev-vs-ci-vs-prod).

---

## Seed users (dev only)

All seeded users share password `password`.

| Email                     | Role                  | Faculty type |
| ------------------------- | --------------------- | ------------ |
| `admin@hmp.local`         | `ADMIN`               | —            |
| `ic@hmp.local`            | `INSTRUCTION_CELL`    | —            |
| `hog@hmp.local`           | `HOG`                 | —            |
| `pc@hmp.local`            | `PROGRAMME_COMMITTEE` | —            |
| `faculty@hmp.local`       | `FACULTY`             | `ON_CAMPUS`  |
| `faculty2@hmp.local`      | `FACULTY`             | `ON_CAMPUS`  |
| `faculty.off@hmp.local`   | `FACULTY`             | `OFF_CAMPUS` |
| `faculty.off2@hmp.local`  | `FACULTY`             | `OFF_CAMPUS` |
| `faculty.adj@hmp.local`   | `FACULTY`             | `ADJUNCT`    |
| `faculty.guest@hmp.local` | `FACULTY`             | `GUEST`      |
| `sme@hmp.local`           | `SME`                 | —            |

The `SME` role is a full approval gate (Prompt 12): the HOG assigns one SME per handout at allocation, faculty submissions route through `SME_REVIEW`, and the SME approves (→ PC's queue) or requests changes (→ faculty) from `/sme/review`. The earlier advisory `SmeNomination` model was dropped in 12-b (migration `drop_sme_nomination`). See [docs/rfp-traceability.md](docs/rfp-traceability.md) row 23.

---

## Architecture summary

Four short paragraphs. Detail in [docs/architecture.md](docs/architecture.md).

**Application shell.** Next.js 14 App Router with a single shared `apps/web` package. All mutations are React Server Actions co-located with their pages (`actions.ts` per route folder). All authenticated routes are gated by NextAuth middleware → server-action `requireRole(...)` → workflow `assertRoleAllowed(...)`. ADMIN is a super-role that bypasses `requireRole` for navigation but not for workflow events.

**Data layer.** Postgres (Prisma) is the single source of truth across **29 models** grouped into identity, academic structure, handout lifecycle, notifications, workflow config, AI artifacts, integration snapshots, and audit. The Prisma client is exported from `@hmp/db` as a singleton; every server action uses it directly or via the helpers in `apps/web/src/lib/`.

**Workflow engine.** [`packages/workflow`](packages/workflow) defines the XState lifecycle and exposes one orchestrator — `transition({ requestId, event, actor, effects? })` — that runs the status update, the caller's atomic side-effects (assignments, approvals, version writes), and the audit row inside a single `prisma.$transaction`. Off-campus / adjunct / guest faculty caps are re-checked inside the transaction's `effects` so concurrent allocations can't both squeak past the limit.

**Cross-cutting layers.** Notifications fan out per workflow event (in-portal + email, both best-effort); audit rows are written automatically inside `transition()` and explicitly via `audit()` for non-workflow mutations; RBAC permission keys are loaded onto the JWT at session-build time but not yet exercised (roles do the gating today); AI features (`@hmp/ai`) wrap OpenAI/Anthropic behind a single client that gracefully no-ops when keys are absent.

---

## Tech stack

- **Runtime**: Next.js 14 (App Router), React 18, TypeScript 5
- **Database**: PostgreSQL 16, Prisma 5
- **Auth**: NextAuth v5 (credentials provider; SSO stub abstraction)
- **Workflow**: XState v5
- **Editor**: TipTap
- **Styling**: Tailwind CSS + shadcn/ui (`@hmp/ui`)
- **Testing**: Vitest (unit), Playwright (E2E)
- **Monorepo**: Turborepo + pnpm workspaces
- **Email**: Nodemailer (Mailhog dev / SMTP prod)
- **Queues**: BullMQ + ioredis ([`@hmp/queue`](packages/queue)) — background workers for notifications + AI quality reports, opt-in via `WORKERS_ENABLED`
- **Object storage**: AWS S3 SDK against MinIO (dev) / S3 (prod) — Taxila Mode B LMS exports ([`packages/integrations/src/storage.ts`](packages/integrations/src/storage.ts))
- **AI**: OpenAI SDK + Anthropic SDK (both optional — features degrade to stubs without keys)

Both BullMQ (Redis-backed queues, Prompt 10) and the S3/MinIO SDK (Taxila Mode B exports, Prompt 9) are now genuinely consumed by the application — earlier READMEs over-claimed these before they existed, so this list reflects what's actually wired today.

---

## Repo layout

```
apps/
  web/                     Next.js app — UI, API routes, server actions, E2E specs

packages/
  db/                      Prisma schema + singleton client + seed
  auth/                    NextAuth config + RBAC helpers + SSO provider interface (stub)
  workflow/                XState machine + transition() orchestrator + role/cap guards
  ai/                      Provider abstraction, embeddings, recommender, quality, draft generator
  integrations/            CSV parsing + ERP schemas, Taxila LMS stub, Nodemailer SMTP
  ui/                      Tailwind shadcn-style primitives

infra/
  docker-compose.yml       Postgres + Redis + MinIO + Mailhog for local dev

scripts/
  start-services.ps1       Windows helper that brings up local infra without Docker
  stop-services.ps1        Counterpart shutdown helper

.github/workflows/
  ci.yml                   Two jobs: lint/typecheck/test/build, then e2e against next start

docs/
  architecture.md          System architecture
  api.md                   REST + server action reference
  admin-guide.md           Admin workflows
  deployment-runbook.md    Production deployment
  roles.md                 Role responsibilities
  user-manuals/            Per-role end-user docs (faculty, hog, ic, pc)
  dev-handoff-audit.md     Conventions, stubs, risks, action items
  rfp-traceability.md      RFP-clause-to-implementation matrix
```

---

## Testing

```bash
pnpm test    # vitest across all packages (185 unit tests today)
pnpm e2e     # playwright against the dev server locally (18 main e2e specs + 10 workers e2e)
```

**213 tests in CI on every push** — 185 unit + 28 e2e (18 main + 10 workers-on m9). Three categories probe-skip when their service is unavailable (Redis-gated `@hmp/queue` integration tests; MinIO-gated m6a/m6c export specs; Mailhog-gated m4d/m6c email-assertion specs) — CI provides the services so the full set runs.

**CI runs both on every push.** The unit job runs `lint → typecheck → test → build` against a Postgres 16 service container. The e2e job runs `build → playwright install chromium → playwright test` — **against the production build (`next start`), not `next dev`**. Dev mode's per-route first-compile and RSC streaming hiccups caused too much flake; production builds are pre-compiled and stable. See commit `279d48c` for the change.

The integration test [`concurrent.test.ts`](apps/web/src/app/ic/requests/new/__tests__/concurrent.test.ts) hits a real Postgres and is skipped when `DATABASE_URL` is unset (so contributors without a local DB don't fail). CI sets it explicitly. AI features are tested with `AI_PROVIDER=noop` so the stub paths are exercised by default; provide an `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` locally to exercise the real provider.

Run the new contributor's smoke test:

```bash
DATABASE_URL=postgresql://hmp:hmp@localhost:5432/hmp pnpm typecheck && pnpm lint && pnpm test
```

That order matches the pre-push checklist: typecheck is the fastest catch-fail signal and surfaces regressions that tests don't (Vitest uses esbuild and strips types without checking them).

---

## Deployment

Deployment runbook — including environment, secrets, Docker images, and post-deploy checks — lives at [docs/deployment-runbook.md](docs/deployment-runbook.md). One open item before production: the **migration story is currently `prisma db push`**; production needs `prisma migrate deploy` once the initial `packages/db/prisma/migrations/` folder is created from the current schema.

---

## For new contributors

Start here:

1. [**docs/dev-handoff-audit.md**](docs/dev-handoff-audit.md) — code conventions (how server actions are structured, how transitions are called, how notifications fire, how audit rows are written, how RBAC is enforced), naming patterns, known stubs, test coverage gaps, the three risky areas where future changes need extra care.
2. [**docs/rfp-traceability.md**](docs/rfp-traceability.md) — every RFP-style requirement mapped to a status (✅/🟡/🔴), the implementing file or route, the test that covers it, and remediation effort estimates for everything not yet ✅.
3. The transition orchestrator at [`packages/workflow/src/transition.ts`](packages/workflow/src/transition.ts) — the spine of the app. Read it, then read [`apps/web/src/app/ic/requests/new/actions.ts`](apps/web/src/app/ic/requests/new/actions.ts) and [`apps/web/src/app/ic/requests/new/ref-no.ts`](apps/web/src/app/ic/requests/new/ref-no.ts) together as the canonical "how a new mutating server action looks today" example.

---

## Team & license

**Team**

- **Syamanth** — Sole contributor. Architecture, full-stack development
  (all role modules: Admin, IC, HOG, PC, Faculty), auth, workflow engine,
  AI layer, ERP/LMS integrations, editor, notifications, dashboards,
  DevOps, design, QA, documentation.

License: TBD (internal BITS WILP project).
