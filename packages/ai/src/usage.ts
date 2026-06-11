import {
  prisma,
  RoleName,
  NotificationChannel,
  NotificationStatus,
  type AiOperation,
} from '@hmp/db';
import { estimateCostUsd } from './pricing';

// AI cost ledger recording (Prompt 17). One row per REAL provider call. Caching
// and stub fallbacks record nothing — they make no API call, so there is no cost
// to attribute (the dashboard's call counts then reflect actual spend, not cache
// hits). Recording is BEST-EFFORT: a tracking write must never fail the
// user-facing AI feature it observes (same discipline as archive tagging in
// Prompt 16 + the notifications module).

/** Attribution context threaded from the call site. Both fields are optional:
 *  worker + page-render paths have no actor; recommendations/embeddings have no
 *  handout. */
export interface AiUsageContext {
  actorId?: string | null;
  handoutId?: string | null;
}

export interface RecordAiUsageInput extends AiUsageContext {
  operation: AiOperation;
  provider: string;
  model: string;
  tokens: { in: number; out: number };
  durationMs: number;
  succeeded: boolean;
  errorMessage?: string;
}

/** Default monthly soft budget (USD) when AI_MONTHLY_BUDGET_USD is unset. */
const DEFAULT_MONTHLY_BUDGET_USD = 200;

function monthlyBudgetUsd(): number {
  const raw = Number(process.env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_BUDGET_USD;
}

function startOfUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** 'YYYY-MM' for the current UTC month — the budget-warning dedup key. */
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Writes one AiUsageLog row + (best-effort) fires the monthly budget warning.
 * Never throws — wraps the whole body so a tracking-infra failure can't break
 * the AI feature. The budget check has its own inner guard so a warning failure
 * can't drop the usage row.
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  try {
    const costUsd = estimateCostUsd(input.model, input.tokens);
    await prisma.aiUsageLog.create({
      data: {
        userId: input.actorId ?? null,
        handoutId: input.handoutId ?? null,
        operation: input.operation,
        provider: input.provider,
        model: input.model,
        tokensIn: input.tokens.in,
        tokensOut: input.tokens.out,
        costUsd,
        durationMs: input.durationMs,
        succeeded: input.succeeded,
        errorMessage: input.errorMessage ?? null,
      },
    });

    // Only a cost-incurring, successful call can push month-to-date over budget.
    if (input.succeeded && costUsd > 0) {
      try {
        await maybeWarnBudget();
      } catch (err) {
        console.warn('[ai-usage] budget-warning check failed', err);
      }
    }
  } catch (err) {
    console.warn('[ai-usage] failed to record usage', { operation: input.operation, err });
  }
}

/**
 * If month-to-date AI spend exceeds the monthly budget, fire a single in-portal
 * warning to every active admin — once per month, deduped via Notification.meta
 * (the exact pattern notifications.ts uses for SLA reminders). Writes the
 * Notification rows + an AuditLog row DIRECTLY via the shared prisma client:
 * @hmp/ai can't import apps/web's notifications.ts (SMTP) without a circular
 * dependency, so the budget alert is in-portal only for now (email delivery is
 * deferred — see docs/dev-handoff-audit.md §6).
 *
 * The findFirst-then-create dedup has a tiny race window (two processes could
 * both see "none" and both create) — acceptable here: worst case is 2 alerts in
 * one month, and budget warnings are inherently low-frequency.
 */
export async function maybeWarnBudget(): Promise<void> {
  const budget = monthlyBudgetUsd();
  const monthStart = startOfUtcMonth();

  const agg = await prisma.aiUsageLog.aggregate({
    where: { createdAt: { gte: monthStart } },
    _sum: { costUsd: true },
  });
  const spend = Number(agg._sum.costUsd ?? 0);
  if (spend <= budget) return;

  const month = currentMonthKey();
  const already = await prisma.notification.findFirst({
    where: {
      AND: [
        { meta: { path: ['kind'], equals: 'ai.budget.exceeded' } },
        { meta: { path: ['month'], equals: month } },
      ],
    },
    select: { id: true },
  });
  if (already) return;

  const admins = await prisma.user.findMany({
    where: { active: true, roles: { some: { role: { name: RoleName.ADMIN } } } },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const subject = `AI spend over budget for ${month}`;
  const body = `Month-to-date AI spend is $${spend.toFixed(2)}, over the $${budget.toFixed(2)} monthly budget. AI features remain enabled (soft cap). Review usage at /admin/ai-metrics.`;
  const meta = { kind: 'ai.budget.exceeded', month, spendUsd: spend, budgetUsd: budget };

  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      channel: NotificationChannel.IN_PORTAL,
      status: NotificationStatus.SENT,
      subject,
      body,
      link: '/admin/ai-metrics',
      meta,
      sentAt: new Date(),
    })),
  });

  await prisma.auditLog.create({
    data: {
      actorId: null, // system-triggered
      action: 'ai.budget.exceeded',
      entity: 'AiUsageLog',
      entityId: month,
      after: { month, spendUsd: spend, budgetUsd: budget, adminsNotified: admins.length },
    },
  });
}
