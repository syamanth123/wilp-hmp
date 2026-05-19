# RFP Traceability Matrix

**Generated:** 2026-05-19 (after Prompt 2 — refNo race fix + E2E in CI).

This document maps every RFP-style requirement for HMP to its current implementation status, the actual file/route that implements it, the test that covers it, and (for anything not yet ✅) a remediation entry with an effort estimate. Every status claim is verifiable against a real file path in the repo today.

Legend:

- ✅ **Done** — implemented end-to-end and exercised by a test (unit, E2E, or both).
- 🟡 **Partial** — works on the happy path but has a named, written-down caveat (stub, missing edge case, blocked on a separate gap).
- 🔴 **Missing** — does not exist in the repo at all. Honesty rule: 🔴 is reserved for "no code anywhere," not "exists but unfinished."

Effort estimates for remediation:

- **S** — < 1 day of focused work.
- **M** — 1–3 days.
- **L** — > 1 week.

---

## Summary

| Tier | Count | Percentage |
|---|---|---|
| ✅ Done | 13 | 42% |
| 🟡 Partial | 11 | 35% |
| 🔴 Missing | 7 | 23% |
| **Total tracked** | **31** | 100% |

_Last updated by Prompt 4 (`feat/sme-schema-and-first-migration`): row 23 (SME flow) flipped 🔴 → 🟡 (schema + seed user landed; routes still missing); row 31 (initial Prisma migration) added as ✅._

**Headline gaps to close before a real deploy** (all 🔴):

- SSO integration (BITS IdP)
- Notification queue (BullMQ workers don't exist; everything is in-band)
- LMS publish (Taxila stub returns simulated success)
- File attachments (no upload code anywhere)
- Backups / disaster recovery
- Security headers (CSP / HSTS / X-Frame-Options)
- Edge rate limiting (only AI in-DB 60s window today)

SME flow is no longer in this 🔴 list — schema, seed user, and migration now exist; routes and UI surface remain. See row 23.

---

## Main matrix

| # | RFP Area | Status | Implementation | Test coverage | Notes / Gaps |
|---|---|:-:|---|---|---|
| 1 | Auth — credentials login (dev) | ✅ | [packages/auth/src/config.ts](../packages/auth/src/config.ts), [apps/web/src/app/login/actions.ts](../apps/web/src/app/login/actions.ts) | E2E [login.spec.ts](../apps/web/e2e/login.spec.ts) (admin + faculty 403) | NextAuth v5 + bcrypt. The same-action cookie gotcha is documented in-line in `login/actions.ts` — do not "clean up" by calling `getSessionUser()` after `signIn()`. |
| 2 | Auth — SSO (production) | 🔴 | [packages/auth/src/sso.ts](../packages/auth/src/sso.ts) — `StubSsoProvider` throws "not configured" | None | Interface defined; no real BITS IdP integration. SAML or OIDC, TBD. |
| 3 | RBAC — 6 roles | 🟡 | Enum in [schema.prisma:18-25](../packages/db/prisma/schema.prisma) | Unit [routing.test.ts](../apps/web/src/lib/routing.test.ts) | 5 roles fully wired (ADMIN/IC/HOG/PC/FACULTY) with routes, dashboards, and seed users. **SME is enum-only** — see row 23. |
| 4 | RBAC — three enforcement layers | ✅ | Middleware [apps/web/src/middleware.ts](../apps/web/src/middleware.ts), action `requireRole(...)` from [packages/auth/src/rbac.ts](../packages/auth/src/rbac.ts), workflow `assertRoleAllowed(...)` from [packages/workflow/src/guards.ts](../packages/workflow/src/guards.ts) | Unit [guards.test.ts](../packages/workflow/src/guards.test.ts) + every E2E spec exercises role gates implicitly | ADMIN is a super-role for navigation but not for workflow events. |
| 5 | Workflow — state machine | ✅ | [packages/workflow/src/machine.ts](../packages/workflow/src/machine.ts) — 11 states, 12 events | Unit [machine.test.ts](../packages/workflow/src/machine.test.ts) | XState v5 + pure transition table (`nextStatus(current, event)`). |
| 6 | Workflow — atomic transitions | ✅ | [packages/workflow/src/transition.ts](../packages/workflow/src/transition.ts) | E2E covers IC → HOG → PC → Faculty → PC → HOG → IC chain in [m6-publish-archive.spec.ts](../apps/web/e2e/m6-publish-archive.spec.ts) | Status update + caller-supplied `effects()` + audit row all inside one `prisma.$transaction`. Roll back on any failure. |
| 7 | Workflow — off-campus / adjunct / guest cap | ✅ | [hog/requests/[id]/actions.ts:81-97](../apps/web/src/app/hog/requests/[id]/actions.ts) — `assertOffCampusCap` inside `effects` so concurrent allocations can't squeak past | Unit [guards.test.ts](../packages/workflow/src/guards.test.ts) covers the assertion | Cap is read from `WorkflowConfig.offCampusMaxCourses` (default 3). |
| 8 | Workflow — refNo uniqueness under concurrent IC creates | ✅ | [apps/web/src/app/ic/requests/new/ref-no.ts](../apps/web/src/app/ic/requests/new/ref-no.ts) — optimistic P2002 retry with jittered backoff, bounded at 5 attempts | Unit [ref-no.test.ts](../apps/web/src/app/ic/requests/new/__tests__/ref-no.test.ts) + real-DB [concurrent.test.ts](../apps/web/src/app/ic/requests/new/__tests__/concurrent.test.ts) (10 simultaneous creates → 10 unique sequential refNos) | Resolved in commit `3b2e834`. Tracked as §6 Risk 3 in the dev-handoff audit. |
| 9 | AI — faculty recommender | 🟡 | [packages/ai/src/recommender.ts](../packages/ai/src/recommender.ts) | Unit [client.test.ts](../packages/ai/src/client.test.ts), E2E [m8-ai-layer.spec.ts](../apps/web/e2e/m8-ai-layer.spec.ts) "heuristic-only mode" | Heuristic score (history overlap + load balance + type nudge) always runs. Embedding similarity replaces 50 % weight when an AI provider key is set. Without keys: `fallbackReason` populated, UI shows "Heuristic-only" badge. |
| 10 | AI — handout draft generator | 🟡 | [packages/ai/src/handout-generator.ts](../packages/ai/src/handout-generator.ts) | E2E exercises the stub path (no AI keys in CI); no test of the real-AI happy path | Stub fallback returns a hardcoded 4-module template marked `source: 'stub'` with an orange banner in the UI. |
| 11 | AI — quality report (Bloom's, coverage, score) | 🟡 | [packages/ai/src/quality.ts](../packages/ai/src/quality.ts) | E2E asserts the "AI provider not configured" message in [m8-ai-layer.spec.ts](../apps/web/e2e/m8-ai-layer.spec.ts) | Requires an AI provider key; throws `AiUnconfiguredError` otherwise. 60-second rate limit (in-DB) per handout. |
| 12 | AI — usage / cost dashboard | 🟡 | [apps/web/src/app/admin/ai-metrics/page.tsx](../apps/web/src/app/admin/ai-metrics/page.tsx) | E2E [m8-ai-layer.spec.ts](../apps/web/e2e/m8-ai-layer.spec.ts) renders provider-status + corpus controls | Per-day usage buckets (recs / reports / drafts / models) work today. **Cost rollup is blocked** on schema migration to promote `promptTokens` / `completionTokens` to indexed columns — admitted in-line at page.tsx:208-211. |
| 13 | Notifications — in-portal | ✅ | [apps/web/src/lib/notifications.ts](../apps/web/src/lib/notifications.ts) `deliver()`, [Notification model](../packages/db/prisma/schema.prisma), bell at [components/notification-bell.tsx](../apps/web/src/components/notification-bell.tsx), inbox at [notifications/page.tsx](../apps/web/src/app/notifications/page.tsx), SSE stream at [api/notifications/stream/route.ts](../apps/web/src/app/api/notifications/stream/route.ts) | E2E [m7-notifications.spec.ts](../apps/web/e2e/m7-notifications.spec.ts) | All workflow transitions fan out per `EVENT_TEMPLATE_KEY` map. |
| 14 | Notifications — email | ✅ | [packages/integrations/src/email.ts](../packages/integrations/src/email.ts) (Nodemailer) | Unit covers template render; no transport-failure test (logged in audit §4 as a gap) | Mailhog dev / SMTP prod. Bounce handling, ESP, and template versioning are not implemented. |
| 15 | Notifications — async / queue | 🔴 | None | None | README previously claimed BullMQ + Redis queues. **Repo-wide `rg "bullmq\|@bullmq"` returns zero matches.** All notification delivery is in-band inside the user's server-action request cycle — a slow SMTP server stalls the user's submit. |
| 16 | SLA tracking + reminder cron | ✅ | [apps/web/src/lib/sla.ts](../apps/web/src/lib/sla.ts) (`classify`, `slaHoursFor`), [api/cron/reminders/route.ts](../apps/web/src/app/api/cron/reminders/route.ts) (bearer-gated) | Unit [sla.test.ts](../apps/web/src/lib/sla.test.ts) + E2E "Admin can run the SLA reminder sweep on demand" | Per-recipient dedup window of `slaHours / 2`. Bearer secret comparison uses `timingSafeEqual`. |
| 17 | Audit trail | ✅ | [apps/web/src/lib/audit.ts](../apps/web/src/lib/audit.ts) for non-workflow paths; workflow audits emitted automatically by `transition()` | Audit rows surface in [admin/audit/page.tsx](../apps/web/src/app/admin/audit/page.tsx); no dedicated audit-content test | Stores before/after JSON. Login attempts and RBAC denials are NOT audited (gap — flagged in audit §5). |
| 18 | Versioning + diff | 🟡 | [apps/web/src/lib/handout-versioning.ts](../apps/web/src/lib/handout-versioning.ts), [components/version-diff.tsx](../apps/web/src/components/version-diff.tsx), [components/version-list.tsx](../apps/web/src/components/version-list.tsx) | E2E covers save + submit; no test for diff rendering or rework-loop version numbering | Versions are immutable (`HandoutVersion.versionNo` unique per handout). Rework loop edge cases not tested. |
| 19 | ERP integration (CSV) | 🟡 | [packages/integrations/src/erp.ts](../packages/integrations/src/erp.ts), [packages/integrations/src/csv.ts](../packages/integrations/src/csv.ts), [admin/import/actions.ts](../apps/web/src/app/admin/import/actions.ts) | Unit [erp.test.ts](../packages/integrations/src/erp.test.ts) covers parse + validate | CSV-paste import works end-to-end (with `ErpSnapshot` audit). **Real ERP HTTP integration is Phase 3** — env vars `ERP_BASE_URL` / `ERP_API_KEY` are declared but no client exists. UI is a `<textarea>`, not a file picker (related to row 21). |
| 20 | LMS publish (Taxila) | 🔴 | [packages/integrations/src/taxila.ts](../packages/integrations/src/taxila.ts) — stub | E2E asserts the stub's `taxila-stub` response signature in [m6-publish-archive.spec.ts](../apps/web/e2e/m6-publish-archive.spec.ts) | `publishToLms()` returns `{ status: 'success', responseJson: { provider: 'taxila-stub', simulatedAt: ... } }`. No HTTP. Status transitions and `LmsPublishLog` writes around it are real. |
| 21 | File attachments / uploads | 🔴 | `Attachment` model + `s3Key` column exist; no producer anywhere | None | Repo-wide `rg "presigned\|S3Client\|@aws-sdk\|PutObjectCommand"` returns zero matches. No `@aws-sdk` dependency, no upload route, no `<input type="file">`. `attachments: true` in [ic/requests/[id]/page.tsx:25](../apps/web/src/app/ic/requests/[id]/page.tsx) is dead — the JSX never renders them. MinIO in compose is unused. |
| 22 | Inline comments | ✅ | [apps/web/src/app/(shared)/comment-actions.ts](../apps/web/src/app/(shared)/comment-actions.ts), [components/comment-thread.tsx](../apps/web/src/components/comment-thread.tsx), [components/comment-form.tsx](../apps/web/src/components/comment-form.tsx) | E2E "Faculty and PC can exchange comments on a request" in [m6-publish-archive.spec.ts](../apps/web/e2e/m6-publish-archive.spec.ts) | Per-handout `Comment` rows; thread locked once status is PUBLISHED / ARCHIVED / REJECTED. Notifies all involved parties (best-effort). |
| 23 | SME flow | 🟡 | `SmeNomination` model + `SmeNominationStatus` enum + back-relations on `HandoutRequest` and `User` ([schema.prisma](../packages/db/prisma/schema.prisma)); migration `*_add_sme_nomination`; seeded `sme@hmp.local` user; idempotent SmeNomination upsert in [seed.ts](../packages/db/prisma/seed.ts) (warn-and-skip when no HandoutRequest exists yet) | None — UI not built yet | **Still missing**: `/sme/*` routes, nomination UI in PC view, SME acceptance/completion server actions, workflow events for SME transitions, notification templates for SME events. Schema is ready; UI flow is the next prompt. |
| 24 | Reporting — faculty workload | 🟡 | [apps/web/src/lib/faculty-load.ts](../apps/web/src/lib/faculty-load.ts) powers HOG allocation | None dedicated | Per-faculty per-semester load is computed inline for the allocation picker. No aggregate workload report page exists. |
| 25 | Reporting — AI usage | 🟡 | [apps/web/src/app/admin/ai-metrics/page.tsx](../apps/web/src/app/admin/ai-metrics/page.tsx) — 14-day rolling buckets | E2E [m8-ai-layer.spec.ts](../apps/web/e2e/m8-ai-layer.spec.ts) "Admin AI metrics page" | Usage volumes ship; cost is blocked (see row 12). |
| 26 | Mobile / responsive UI | 🟡 | Tailwind responsive utilities are present (`sm:`, `lg:`, etc. in many components); login + admin pages use responsive grids | None | No formal responsive audit, no documented breakpoints policy, no mobile-specific E2E run. |
| 27 | Accessibility | 🟡 | Keyboard navigation works; `htmlFor` / `id` pairs were added to the IC create form in commit `7733185` (Prompt 2) | None automated | No axe-core / Lighthouse run in CI. ARIA labels and focus management have not been audited end-to-end. |
| 28 | Backups / disaster recovery | 🔴 | None | None | `infra/docker-compose.yml` declares named volumes for Postgres/Redis/MinIO but nothing snapshots them. No documented restore procedure beyond a paragraph in `docs/deployment-runbook.md`. |
| 29 | Security headers (CSP / HSTS / X-Frame-Options) | 🔴 | None | None | [apps/web/next.config.mjs](../apps/web/next.config.mjs) sets no security headers. Default Next.js exposure. |
| 30 | Rate limiting at edge | 🔴 | Only [packages/ai/src/quality.ts](../packages/ai/src/quality.ts) has a 60-second in-DB rate limit per handout | None | No per-IP or per-user rate limit on `/api/notifications/stream`, `/api/cron/reminders`, login, or any server action. DDoS/abuse exposure. |
| 31 | Initial Prisma migration | ✅ | [`packages/db/prisma/migrations/`](../packages/db/prisma/migrations) — `*_init` baseline (28 models) + `*_add_sme_nomination` (29th model + enum). [migration_lock.toml](../packages/db/prisma/migrations/migration_lock.toml) pins provider to `postgresql`. | Integration test [concurrent.test.ts](../apps/web/src/app/ic/requests/new/__tests__/concurrent.test.ts) runs against the migrated DB and passes. Local + CI both verified. | Production now uses `prisma migrate deploy` (see [deployment-runbook.md § Migration lifecycle](deployment-runbook.md)). CI still uses `db push` for speed against per-run service containers — acceptable while the schema is small; revisit when migration count grows. |

---

## Gap remediation plan

Every 🟡 and 🔴 from above, with effort estimate and the prompt that addresses it (or `NEW` for not-yet-planned).

| # | Gap | Effort | Addressed by |
|---|---|---|---|
| 2 | Implement real BITS SSO (SAML or OIDC) behind the `SsoProvider` interface | **L** | `NEW` — requires real IdP coordination |
| 3 | Wire SME UI: `/sme/*` routes, PC-side nomination form, SME accept/decline/complete actions, workflow event matrix entries, notification templates. (Schema + seed user + first migration landed in Prompt 4.) | **M** | Prompts 5–8 |
| 9 | Test real-AI recommender happy path with a recorded fixture | **S** | `NEW` (M9 polish bucket) |
| 10 | Test real-AI handout draft happy path with a recorded fixture | **S** | `NEW` (M9 polish bucket) |
| 11 | Test real-AI quality report happy path with a recorded fixture | **S** | `NEW` (M9 polish bucket) |
| 12 | Schema migration to promote `promptTokens` / `completionTokens` to columns on `AIDraftLog` / `AIRecommendation` / `AIQualityReport`; thread token usage from provider responses; add cost-rollup card | **M** | Tracked as audit §8 items 1 + 2 — `NEW` |
| 14 | Wire bounce handling + transactional ESP + template versioning for email | **M** | `NEW` |
| 15 | Build BullMQ queue + worker process for notification delivery; move `notifyTransition` and `notifySlaReminder` to enqueue rather than deliver inline | **M** | `NEW` |
| 17 | Audit login attempts (success + failure) and RBAC denials | **S** | `NEW` |
| 18 | Add E2E coverage for the rework loop (`SUBMITTED → REWORK_REQUESTED → SUBMITTED` ≥ 2 cycles); assert version numbering and approval-row accumulation | **S** | `NEW` (M9 polish bucket) |
| 19 | Replace CSV `<textarea>` with a real file picker; build the real ERP HTTP client (Phase 3) | **M** | `NEW` |
| 20 | Replace `publishToLms` stub with the real Taxila HTTP client behind the same `PublishResult` signature | **M** | `NEW` (Phase 3) |
| 21 | Decide: build file uploads (S3 SDK + presigned PUT route + `<input type="file">` UI + `prisma.attachment.create`) OR drop the `Attachment` model + `s3Key` column + the dead `attachments: true` include | **L** if building / **S** if dropping | `NEW` — feature-sized decision |
| 23 | (Duplicate of row 3 — single SME line item.) | — | — |
| 24 | Faculty workload aggregate report page (per-programme, per-semester) | **S** | `NEW` |
| 25 | (Blocked on row 12 — once token columns land, cost shows up automatically.) | — | Same as 12 |
| 26 | Formal responsive audit + mobile-specific E2E project in Playwright config | **M** | `NEW` |
| 27 | Add axe-core or Lighthouse-CI to the e2e job; document ARIA / focus conventions in `dev-handoff-audit.md` | **M** | `NEW` |
| 28 | Postgres backup cron (pg_dump → S3) + documented restore procedure | **M** | `NEW` (deploy prereq) |
| 29 | Add CSP / HSTS / X-Frame-Options / Referrer-Policy in `next.config.mjs` headers | **S** | `NEW` (deploy prereq) |
| 30 | Edge rate limiting (e.g. `@upstash/ratelimit` keyed by IP + user) on login, SSE, cron, and server actions | **M** | `NEW` (deploy prereq) |

**Deploy-blockers in this list** (must close before a real production deploy): 2 (SSO), 20 (LMS), 28 (backups), 29 (security headers), 30 (rate limiting). Plus the migration-folder gap from the README (currently `db push`, must be `migrate deploy`).

**Honesty rule for future updates to this file:** the moment a row's claim is no longer verifiable against the actual files, fix the row in the same commit as the code change. A traceability matrix that lies is worse than no matrix.
