# API Reference

The HMP portal exposes both Next.js route handlers (REST/SSE) and React Server Actions. All endpoints require a valid NextAuth session unless noted.

## REST routes

### `GET /api/auth/[...nextauth]`

NextAuth v5 catch-all. Handles `signin`, `signout`, `session`, `csrf`. Configured in `packages/auth/src/config.ts` with a credentials provider for dev.

### `GET /api/notifications/stream`

Server-Sent Events. Long-poll-style stream that emits:

- `event: ready` — initial unread count.
- `event: notification` (every 10 s if changed) — `{ unread: number, recent: Notification[] }`.
- `:heartbeat` comment every 25 s.

Max runtime 5 minutes per connection; client (`<NotificationBell />`) auto-reconnects.

Auth: session cookie. 401 if anonymous.

### `GET|POST /api/cron/reminders`

SLA reminder sweep.

- **Auth**: `Authorization: Bearer <CRON_SECRET>` header. 401 otherwise.
- **Body**: none.
- **Response**: `{ scanned, dueSoon, overdue, notified }`.
- **Behavior**: scans non-terminal `HandoutRequest` rows, classifies via `apps/web/src/lib/sla.ts:classify`, deduplicates per `(requestId, classification, recipientId)` within `slaHours/2`, and emits one `notification.sla.reminder` per (recipient, request) pair.

## Server Actions (mutations)

All server actions live next to the pages that call them under `apps/web/src/app/.../actions.ts`. They are RBAC-guarded via `requireRole` from `@hmp/auth`.

| Path                                  | Action                                                                   | Role                       | Effect                                                             |
| ------------------------------------- | ------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `ic/requests/new/actions.ts`          | `createRequestAction`                                                    | `INSTRUCTION_CELL`         | `REQUEST_INITIATED` → `REQUESTED`, generates `HMP-YYYY-####`       |
| `ic/requests/[id]/actions.ts`         | `publishAction`                                                          | `INSTRUCTION_CELL`         | `PUBLISHED` + `LmsPublishLog` + `Approval(IC_PUBLISH)`             |
| `ic/requests/[id]/actions.ts`         | `archiveAction`                                                          | `INSTRUCTION_CELL`         | `ARCHIVED`                                                         |
| `hog/requests/[id]/actions.ts`        | `allocateFacultyAction`                                                  | `HOG`                      | `FACULTY_ALLOCATED` → `ALLOCATED`, writes `FacultyAssignment` rows |
| `hog/requests/[id]/actions.ts`        | `finalApproveAction`                                                     | `HOG`                      | `FINAL_APPROVED` → `APPROVED`                                      |
| `hog/requests/[id]/actions.ts`        | `finalRejectAction`                                                      | `HOG`                      | `FINAL_REJECTED` → `REJECTED`                                      |
| `hog/requests/[id]/actions.ts`        | `hogRequestReworkAction`                                                 | `HOG`                      | `REVIEW_REWORK` (from `UNDER_REVIEW`) → `REWORK_REQUESTED`         |
| `hog/requests/[id]/actions.ts`        | `regenerateRecommendationAction`                                         | `HOG`                      | Clears today's AI recommendation cache + re-runs                   |
| `pc/requests/[id]/actions.ts`         | `confirmAssignmentAction`                                                | `PROGRAMME_COMMITTEE`      | `ASSIGNED`                                                         |
| `pc/requests/[id]/actions.ts`         | `pcReviewApproveAction`                                                  | `PROGRAMME_COMMITTEE`      | `REVIEW_APPROVED` → `UNDER_REVIEW`                                 |
| `pc/requests/[id]/actions.ts`         | `pcReviewReworkAction`                                                   | `PROGRAMME_COMMITTEE`      | `REVIEW_REWORK` → `REWORK_REQUESTED`                               |
| `faculty/assignments/[id]/actions.ts` | `acceptAssignmentAction`                                                 | `FACULTY`                  | Sets `FacultyAssignment.acceptedAt`                                |
| `faculty/assignments/[id]/actions.ts` | `startEditingAction`                                                     | `FACULTY`                  | `EDIT_STARTED` → `IN_PROGRESS`, creates v1 from template           |
| `faculty/assignments/[id]/actions.ts` | `saveDraftAction`                                                        | `FACULTY`                  | Appends `HandoutVersion`, no status change                         |
| `faculty/assignments/[id]/actions.ts` | `submitForReviewAction`                                                  | `FACULTY`                  | Appends version + `SUBMITTED`; auto-fires quality check            |
| `faculty/assignments/[id]/actions.ts` | `runQualityCheckAction`                                                  | `FACULTY`                  | Calls `runQualityReport`; rate-limited 60 s                        |
| `(shared)/comment-actions.ts`         | `addCommentAction`                                                       | any role with route access | Writes `Comment` row + `notifyComment`                             |
| `admin/import/actions.ts`             | `previewCoursesAction` / `commitCoursesAction` (+ programmes, offerings) | `ADMIN`                    | Atomic upsert + `ErpSnapshot`                                      |
| `admin/users/actions.ts`              | `createUserAction`, `updateUserAction`, `deactivateUserAction`           | `ADMIN`                    | User CRUD + audit                                                  |
| `admin/workflow/actions.ts`           | `updateWorkflowConfigAction`                                             | `ADMIN`                    | Updates SLAs + cap                                                 |
| `admin/notifications/actions.ts`      | `runSweepAction`                                                         | `ADMIN`                    | Calls `/api/cron/reminders` server-side                            |
| `admin/ai-metrics/actions.ts`         | `reEmbedAllAction`                                                       | `ADMIN`                    | Triggers `ensureCorpusEmbeddings`                                  |
| `notifications/actions.ts`            | `markReadAction`, `markAllReadAction`                                    | any                        | Updates `Notification.status=READ`                                 |

All actions:

- Validate input via Zod.
- Wrap status changes through `transition()` from `@hmp/workflow` — atomic update + audit + optional `effects(tx, ctx)` callback running inside the same `$transaction`.
- Call `notifyTransition()` (`apps/web/src/lib/notifications.ts`) after successful transitions (best-effort try/catch; never blocks workflow).

## Workflow events

Defined in `packages/workflow/src/machine.ts`. Each event maps a `from` status to a `to` status and is gated by `EVENT_ROLE_MATRIX` in `packages/workflow/src/guards.ts`. Invalid transitions throw `WorkflowError`.

## Error responses

Server actions return `{ error: string }` for handled errors (RBAC, validation, workflow). REST routes return appropriate HTTP codes (401, 403, 4xx, 500) with JSON bodies.
