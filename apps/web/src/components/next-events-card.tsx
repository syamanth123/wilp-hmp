import type { NextEvents } from '@hmp/db/src/dibba-schedule';

const fmtDay = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

const KIND_LABEL: Record<string, string> = {
  MID_SEM: 'Mid-semester exam',
  COMPREHENSIVE: 'Comprehensive exam',
  MAKEUP: 'Make-up exam',
};

/**
 * "Next class / next exam" (Phase 5, plan D7). Server component; pure render of
 * the nextEvents() result. `termName` null = no published term at all.
 */
export function NextEventsCard({
  next,
  termName,
}: {
  next: NextEvents | null;
  termName: string | null;
}) {
  return (
    <div className="glass-panel overflow-hidden rounded-[10px]" data-testid="faculty-next-events">
      <div className="panel-head">
        <h3>Next class / next exam</h3>
        {termName && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{termName}</span>}
      </div>
      <div className="panel-body grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--muted)',
              fontWeight: 600,
            }}
          >
            Next class
          </div>
          {next?.nextClass ? (
            <p style={{ margin: '4px 0 0', fontSize: 14 }} data-testid="faculty-next-class">
              <strong>{fmtDay.format(next.nextClass.date)}</strong> · SL{next.nextClass.slotNo}{' '}
              {next.nextClass.day} {next.nextClass.session}
              {next.nextClass.startTime
                ? ` · ${next.nextClass.startTime}–${next.nextClass.endTime ?? ''}`
                : ''}
              <br />
              <span className="font-mono" style={{ fontSize: 12.5 }}>
                {next.nextClass.codes.join(' / ')}
              </span>
            </p>
          ) : (
            <p
              style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}
              data-testid="faculty-next-class"
            >
              {termName
                ? 'No slot of yours in the published schedule.'
                : 'No published schedule yet.'}
            </p>
          )}
        </div>
        <div>
          <div
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--muted)',
              fontWeight: 600,
            }}
          >
            Next exam
          </div>
          {next?.nextExam ? (
            <p style={{ margin: '4px 0 0', fontSize: 14 }} data-testid="faculty-next-exam">
              <strong>{fmtDay.format(next.nextExam.date)}</strong> ·{' '}
              {KIND_LABEL[next.nextExam.kind] ?? next.nextExam.kind}
              {next.nextExam.startTime ? ` · ${next.nextExam.startTime}` : ''} · SL
              {next.nextExam.slotNo}
              <br />
              <span className="font-mono" style={{ fontSize: 12.5 }}>
                {next.nextExam.codes.join(' / ')}
              </span>
            </p>
          ) : (
            <p
              style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}
              data-testid="faculty-next-exam"
            >
              No exam date entered for your slots yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
