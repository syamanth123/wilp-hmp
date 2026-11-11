import { prisma, type DeadlineStage } from '@hmp/db';
import { actionSentence } from './labels';
import { STAGE_LABEL, formatDueDay } from './deadlines';

/**
 * A request's history in plain sentences, with names — shown on the request page (components/status-timeline)
 * and, the last few steps, in emails (v1.4.3, lib/email). Moved out of the component unchanged.
 */

const ROLE_WORD: Record<string, string> = {
  HOG: 'HOG',
  PROGRAMME_COMMITTEE: 'PC',
  PC: 'PC',
  FACULTY: 'Faculty',
  SME: 'SME',
};

type J = Record<string, unknown> | null;
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** v1.4.2: user ids an entry mentions (assignments, hand-overs, back-ups). */
function idsIn(before: J, after: J): string[] {
  return [before?.userId, after?.userId, after?.hogId].filter(
    (x): x is string => typeof x === 'string',
  );
}

/**
 * v1.4.2 (§9.4): the names behind an entry — "HOG: Dr B (CSIS)", "PC: Dr A → Dr C · reason", a changed
 * due date, "for Dr X" when a back-up acted.
 */
function detail(
  action: string,
  before: J,
  after: J,
  people: Map<string, { name: string; dept: string | null }>,
): string | null {
  const who = (id: unknown) => {
    const p = typeof id === 'string' ? people.get(id) : undefined;
    return p ? `${p.name}${p.dept ? ` (${p.dept})` : ''}` : null;
  };
  const parts: string[] = [];
  if ((action === 'request.create' || action === 'request.assign-hog') && who(after?.hogId))
    parts.push(`HOG: ${who(after?.hogId)}`);
  if (action === 'request.reassign') {
    const role = ROLE_WORD[str(after?.role) ?? ''] ?? 'Person';
    const from = who(before?.userId);
    const to = who(after?.userId);
    if (to) parts.push(`${role}: ${from ? `${from} → ` : ''}${to}`);
    if (str(after?.reason)) parts.push(`“${str(after?.reason)}”`);
  }
  if (action === 'request.deadline') {
    const stage = str(after?.stage) as DeadlineStage | null;
    const d = (v: unknown) => (typeof v === 'string' ? formatDueDay(new Date(v)) : null);
    if (stage)
      parts.push(
        `${STAGE_LABEL[stage] ?? stage} due ${d(before?.dueAt) ? `${d(before?.dueAt)} → ` : ''}${d(after?.dueAt) ?? ''}`,
      );
    if (str(after?.reason)) parts.push(`“${str(after?.reason)}”`);
  }
  // v1.4.2 (H18): a back-up acted for an away colleague (in the transition's meta, or on the entry itself).
  const meta = (after?.meta ?? null) as J;
  const forName = str(after?.onBehalfOfName) ?? str(meta?.onBehalfOfName);
  if (forName) parts.push(`for ${forName} (away)`);
  return parts.length ? parts.join(' · ') : null;
}

export interface TimelineEntry {
  id: string;
  at: Date;
  sentence: string;
  /** The status the request moved to, when the step changed it. */
  status: string | null;
  detail: string | null;
  actorName: string | null;
}

export async function requestTimeline(requestId: string): Promise<TimelineEntry[]> {
  const allLogs = await prisma.auditLog.findMany({
    where: {
      OR: [{ requestId }, { entity: 'HandoutRequest', entityId: requestId }],
    },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true, email: true } } },
  });

  // One action can write two log rows (the workflow step and the action's own
  // record). Rows saying the same thing within a minute are shown once,
  // keeping the one that carries the new status.
  const statusOf = (l: (typeof allLogs)[number]) =>
    (l.after as { status?: string } | null)?.status ?? null;
  const logs: typeof allLogs = [];
  for (const log of allLogs) {
    const last = logs[logs.length - 1];
    if (
      last &&
      actionSentence(last.action) === actionSentence(log.action) &&
      log.createdAt.getTime() - last.createdAt.getTime() < 60_000
    ) {
      if (!statusOf(last) && statusOf(log)) logs[logs.length - 1] = log;
      continue;
    }
    logs.push(log);
  }

  const ids = [...new Set(logs.flatMap((l) => idsIn(l.before as J, l.after as J)))];
  const people = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, department: { select: { name: true } } },
      })
    ).map((u) => [u.id, { name: u.name, dept: u.department?.name ?? null }]),
  );

  return logs.map((log) => ({
    id: log.id,
    at: log.createdAt,
    sentence: actionSentence(log.action),
    status: statusOf(log),
    detail: detail(log.action, log.before as J, log.after as J, people),
    actorName: log.actor?.name ?? null,
  }));
}
