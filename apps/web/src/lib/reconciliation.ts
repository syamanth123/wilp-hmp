import { prisma, HandoutStatus } from '@hmp/db';
import { getS3Client, tagObject } from '@hmp/integrations';
import { audit } from '@/lib/audit';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments';

/**
 * Reconciliation sweep (Prompt 21). Operational closure for best-effort side
 * effects: a periodic pass that detects effects that silently failed and
 * repairs them. Triggered by the external cron → /api/cron/reconcile (the same
 * pattern as /api/cron/reminders — this codebase schedules via authenticated
 * HTTP endpoints, NOT BullMQ repeatable jobs).
 *
 * The framework is general: an effect implements detect → reconcile → describe.
 * Currently ONE effect is reconciled (archive tagging). Three other best-effort
 * effects were evaluated and deliberately NOT reconciled (budget warning,
 * notification delivery, on-submit quality report) — see docs/dev-handoff-audit.md
 * §1 "reconciliation evaluation criteria" for the per-effect reasoning.
 */

export interface ReconciliationEffect<T> {
  /** Audit label, e.g. 'archive-tagging'. */
  name: string;
  /** Returns up to `limit` entities with unreconciled state (an indexable DB
   *  query — NOT external-service polling). */
  detect(limit: number): Promise<T[]>;
  /** Idempotent repair. Throws on failure (the sweep records it + continues). */
  reconcile(entity: T): Promise<void>;
  /** A stable id for the entity, for the audit row. */
  describe(entity: T): string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Cap entities processed per effect per sweep — a backlog drains over several
 *  daily runs rather than one mega-run hammering S3. */
const DEFAULT_PER_EFFECT_LIMIT = 200;
/** Pace reconcile() calls so a large batch doesn't hammer S3. */
const RECONCILE_DELAY_MS = 50;

// ── Archive tagging — the one concrete effect ────────────────────────────────
// ARCHIVED-request attachments whose `archived=true` S3 tag never got applied
// (tagAttachmentsArchived swallowed the failure → archivedTaggedAt left NULL).
const archiveTaggingReconciliation: ReconciliationEffect<{ id: string; s3Key: string }> = {
  name: 'archive-tagging',
  detect(limit) {
    return prisma.attachment.findMany({
      where: { archivedTaggedAt: null, request: { status: HandoutStatus.ARCHIVED } },
      select: { id: true, s3Key: true },
      take: limit,
    });
  },
  async reconcile({ id, s3Key }) {
    await tagObject(getS3Client(), ATTACHMENTS_BUCKET, s3Key, { archived: 'true' });
    // Record success so this attachment is never re-detected (idempotency +
    // "stop retrying" both fall out of this single write).
    await prisma.attachment.update({ where: { id }, data: { archivedTaggedAt: new Date() } });
  },
  describe: (e) => e.id,
};

// Registry. Each effect is internally type-safe (its detect output feeds its own
// reconcile/describe); erased to `unknown` here so heterogeneous effects share
// one list. The sweep only ever passes an effect's own detect() output back to
// its own reconcile()/describe(), so the erasure is sound.
const EFFECTS: ReconciliationEffect<unknown>[] = [
  archiveTaggingReconciliation as unknown as ReconciliationEffect<unknown>,
];

export interface EffectSummary {
  found: number;
  reconciled: number;
  failed: number;
}

/**
 * Runs every registered effect. Best-effort at every layer — a failing
 * reconcile() records a `reconciliation.failed` audit row and continues; a
 * failing detect() is logged and the other effects still run. Never throws.
 */
export async function runReconciliationSweep(opts?: {
  perEffectLimit?: number;
}): Promise<Record<string, EffectSummary>> {
  const limit = opts?.perEffectLimit ?? DEFAULT_PER_EFFECT_LIMIT;
  const summary: Record<string, EffectSummary> = {};

  for (const effect of EFFECTS) {
    const s: EffectSummary = { found: 0, reconciled: 0, failed: 0 };
    try {
      const entities = await effect.detect(limit);
      s.found = entities.length;
      for (const entity of entities) {
        try {
          await effect.reconcile(entity);
          s.reconciled += 1;
          await audit({
            action: 'reconciliation.success',
            entity: 'Reconciliation',
            entityId: effect.describe(entity),
            after: { effect: effect.name },
          });
        } catch (err) {
          s.failed += 1;
          await audit({
            action: 'reconciliation.failed',
            entity: 'Reconciliation',
            entityId: effect.describe(entity),
            after: { effect: effect.name, error: err instanceof Error ? err.message : String(err) },
          }).catch(() => undefined); // audit write is itself best-effort
        }
        await sleep(RECONCILE_DELAY_MS);
      }
    } catch (err) {
      // A detect() failure must not cascade to other effects.
      console.warn(`[reconciliation] effect ${effect.name} sweep failed`, err);
    }
    summary[effect.name] = s;
  }
  return summary;
}
