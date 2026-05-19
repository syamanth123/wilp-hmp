# HMP — Architecture

## Monorepo
- `apps/web` — Next.js 14 (App Router). UI + API routes + server actions.
- `packages/db` — Prisma schema + client. Single source of truth for entities.
- `packages/auth` — NextAuth config + RBAC helpers + SSO provider abstraction.
- `packages/workflow` — XState handout lifecycle machine + transition table.
- `packages/ui` — Tailwind + headless shadcn-style component library.
- `packages/ai` — (M8) AI recommender + Bloom's quality checker.
- `packages/integrations` — (M3+) ERP, Taxila LMS, email adapters.
- `infra/` — Docker Compose for local Postgres, Redis, MinIO, Mailhog.

## Auth
- Dev: credentials provider (bcrypt password hashes).
- Prod: implement `SsoProvider` interface in `packages/auth/src/sso.ts` and register via `registerSsoProvider`. NextAuth provider then wraps the SSO flow. JWT session carries `userId`, `roles[]`, `permissions[]`.

## RBAC
- 6 roles: `ADMIN`, `INSTRUCTION_CELL`, `HOG`, `PROGRAMME_COMMITTEE`, `FACULTY`, `SME`.
- Permissions are key-strings (e.g. `handout.approve`) attached to roles in seed.
- `requireRole` / `requirePermission` in `@hmp/auth` enforce server-side.
- Middleware redirects unauthenticated users to `/login`.
- `AppShell` renders 403 for cross-role access.

## Handout Lifecycle (XState)
States: `DRAFT → REQUESTED → ALLOCATED → ASSIGNED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED → ARCHIVED`. Branches: `REWORK_REQUESTED` (loop back to `SUBMITTED`) and `REJECTED` (terminal).

## Data Storage
- Postgres for relational data (Prisma).
- MinIO (S3) for handout attachments, archived versions (M5).
- Redis + BullMQ for queues (notifications, AI jobs, LMS publish) — wired in M7.

## Audit
- Every admin mutation calls `audit()` (`src/lib/audit.ts`). Records before/after, actor, IP/UA. Append-only.

## CI
- GitHub Actions workflow at `.github/workflows/ci.yml` runs install → migrate → lint → typecheck → test → build against a postgres service container.
