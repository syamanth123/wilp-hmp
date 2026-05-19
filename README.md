# Handout Management Portal (HMP)

BITS WILP — Course Handout Management Portal. Automates the end-to-end lifecycle of course handouts across programmes, semesters, and courses.

## Team
- Deepanshu — Tech Lead / Full Stack (architecture, auth, workflow, AI, DevOps)
- Ritwik — Full Stack (IC + HOG + PC modules, ERP/LMS integrations)
- Shyamanth — Full Stack (Faculty module, editor, notifications, dashboards)
- Shipra — Design / QA / Documentation

## Stack
- Next.js 14 (App Router) + TypeScript
- PostgreSQL 16 + Prisma ORM
- NextAuth v5 (SSO stub abstraction)
- XState workflow engine
- TipTap editor
- BullMQ + Redis queues
- Tailwind CSS + shadcn/ui
- MinIO (S3-compatible) for file storage
- Mailhog (dev) / SMTP (prod)
- Vitest + Playwright tests
- Turborepo + pnpm workspaces

## Prerequisites
- Node 20+
- pnpm 9+
- Docker + Docker Compose

## Local bring-up

```bash
cp .env.example .env
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

App: http://localhost:3000
Mailhog UI: http://localhost:8025
MinIO console: http://localhost:9001 (hmpaccess / hmpsecret123)
Prisma Studio: `pnpm db:studio`

## Seeded users (dev)

| Email | Password | Role |
|-------|----------|------|
| admin@hmp.local | password | ADMIN |
| ic@hmp.local | password | INSTRUCTION_CELL |
| hog@hmp.local | password | HOG |
| pc@hmp.local | password | PROGRAMME_COMMITTEE |
| faculty@hmp.local | password | FACULTY |

## Repo layout

```
apps/
  web/                  Next.js app (UI + API routes)
packages/
  db/                   Prisma schema + migrations + seed
  auth/                 NextAuth config + SSO stub + RBAC helpers
  workflow/             XState handout state machine
  ui/                   Shared Tailwind/shadcn components
  ai/                   AI recommender + quality checks (M8)
  integrations/         ERP / LMS / email adapters (M3, M6, M7)
infra/
  docker-compose.yml    Postgres, Redis, MinIO, Mailhog
.github/workflows/      CI
```

## Scripts

```bash
pnpm dev          # run all apps
pnpm build        # build all
pnpm lint         # lint
pnpm typecheck    # tsc --noEmit across workspaces
pnpm test         # vitest
pnpm e2e          # playwright
pnpm db:migrate   # prisma migrate dev
pnpm db:seed      # seed dev data
pnpm db:reset     # drop + migrate + seed
pnpm db:studio    # prisma studio
```

## Milestones

| # | Status | Scope |
|---|--------|-------|
| M1+M2 | in progress | Foundations + Admin module |
| M3 | pending | Workflow engine + IC module |
| M4 | pending | HOG + PC modules |
| M5 | pending | Faculty + Editor |
| M6 | pending | Review/rework + Publish + Archive |
| M7 | pending | Notifications + Dashboards |
| M8 | pending | AI layer |
| M9 | pending | Tests + Docs + Polish |

See `/Users/deepanshujangir/.claude/plans/zany-swinging-bunny.md` for the full plan.
