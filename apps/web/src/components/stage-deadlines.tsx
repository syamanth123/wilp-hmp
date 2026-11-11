import { prisma } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import {
  DEADLINE_SELECT,
  deadlineInput,
  deadlinesFor,
  dueWords,
  formatDueDay,
  loadDeadlineConfig,
} from '@/lib/deadlines';
import { canChangeDeadlines } from '@/lib/deadline-access';
import { ChangeDeadline } from './stage-deadlines-form';

/** "2026-12-12" (India time) for the date field. */
const isoIst = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * v1.4.2 — the request's due date for each step (docs/plans/v1.4.2-workload.md §1), on every request page.
 * The IC and the request's HOG can change one, with a reason.
 */
export async function StageDeadlines({ requestId }: { requestId: string }) {
  const [me, cfg, row] = await Promise.all([
    getSessionUser(),
    loadDeadlineConfig(),
    prisma.handoutRequest.findUnique({ where: { id: requestId }, select: DEADLINE_SELECT }),
  ]);
  if (!row || !me) return null;
  if (row.status === 'DRAFT' || row.status === 'REJECTED') return null;
  const stages = deadlinesFor(deadlineInput(row), cfg);
  const canEdit = await canChangeDeadlines(me, requestId);
  const finished = row.status === 'PUBLISHED' || row.status === 'ARCHIVED';

  return (
    <table className="w-full text-sm" data-testid="stage-deadlines">
      <thead>
        <tr className="text-muted-foreground border-b text-left">
          <th className="py-1.5 pr-3 font-medium">Step</th>
          <th className="py-1.5 pr-3 font-medium">Due</th>
          <th className="py-1.5 pr-3 font-medium" />
          {canEdit && !finished ? <th className="py-1.5 font-medium" /> : null}
        </tr>
      </thead>
      <tbody>
        {stages.map((s) => {
          const words = s.state === 'current' ? dueWords(s.dueAt) : null;
          return (
            <tr
              key={s.stage}
              className={`border-b align-top ${s.state === 'current' ? 'bg-amber-50/60 font-medium' : ''} ${
                s.state === 'done' ? 'text-muted-foreground' : ''
              }`}
              data-testid="stage-deadline-row"
            >
              <td className="py-1.5 pr-3">
                {s.label}
                {s.state === 'current' ? (
                  <span className="ml-1 text-xs font-normal">← now</span>
                ) : null}
                {s.state === 'done' ? <span className="ml-1 text-xs">✓</span> : null}
              </td>
              <td className="py-1.5 pr-3 tabular-nums">{formatDueDay(s.dueAt)}</td>
              <td className="py-1.5 pr-3 text-xs">
                {words ? (
                  <span
                    className={
                      words.tone === 'overdue'
                        ? 'font-semibold text-red-700'
                        : words.tone === 'soon'
                          ? 'font-semibold text-amber-800'
                          : 'text-muted-foreground'
                    }
                  >
                    {words.text}
                  </span>
                ) : null}
                {s.source === 'manual' ? (
                  <div className="text-muted-foreground" data-testid="stage-deadline-manual">
                    changed by {s.setByName ?? 'someone'} — “{s.reason}”
                  </div>
                ) : null}
              </td>
              {canEdit && !finished ? (
                <td className="py-1.5 text-right">
                  {s.state !== 'done' ? (
                    <ChangeDeadline
                      requestId={requestId}
                      stage={s.stage}
                      label={s.label}
                      current={isoIst(s.dueAt)}
                      manual={s.source === 'manual'}
                    />
                  ) : null}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
