'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@hmp/ui';
import { saveExamDatesAction } from './actions';

export interface ExamCell {
  date: string; // YYYY-MM-DD or ''
  startTime: string;
  endTime: string;
}

export interface ExamSlotRow {
  slotNo: number;
  day: string;
  session: string;
  MID_SEM: ExamCell;
  COMPREHENSIVE: ExamCell;
}

const KINDS = [
  { kind: 'MID_SEM', label: 'Mid-semester exam' },
  { kind: 'COMPREHENSIVE', label: 'Comprehensive exam' },
] as const;

/** Exam dates per slot (Phase 4, plan D5). Empty date = no exam date for that slot/kind. */
export function ExamDatesForm({ termId, slots }: { termId: string; slots: ExamSlotRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <form
      action={(fd) => {
        setError(null);
        setDone(null);
        startTransition(async () => {
          const res = await saveExamDatesAction(fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          const parts = [];
          if (res.upserted)
            parts.push(`${res.upserted} exam date${res.upserted === 1 ? '' : 's'} saved`);
          if (res.deleted) parts.push(`${res.deleted} removed`);
          setDone(parts.length ? `Saved — ${parts.join(', ')}.` : 'Nothing changed.');
          router.refresh();
        });
      }}
      data-testid="dibba-exam-dates-form"
    >
      <input type="hidden" name="termId" value={termId} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-2 pr-3 font-medium">Slot</th>
              {KINDS.map((k) => (
                <th key={k.kind} className="py-2 pr-3 font-medium" colSpan={3}>
                  {k.label}
                </th>
              ))}
            </tr>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="py-1 pr-3 font-normal"></th>
              {KINDS.map((k) => (
                <>
                  <th key={`${k.kind}-d`} className="py-1 pr-3 font-normal">
                    Exam date
                  </th>
                  <th key={`${k.kind}-s`} className="py-1 pr-3 font-normal">
                    from
                  </th>
                  <th key={`${k.kind}-e`} className="py-1 pr-3 font-normal">
                    to
                  </th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.slotNo} className="border-b last:border-0">
                <td className="py-2 pr-3 font-mono">
                  SL{s.slotNo}{' '}
                  <span className="text-muted-foreground font-sans text-xs">
                    {s.day} {s.session}
                  </span>
                </td>
                {KINDS.map((k) => {
                  const cell = s[k.kind];
                  const base = `exam-${s.slotNo}-${k.kind}`;
                  const idBase = `exam-${s.slotNo}-${k.kind === 'MID_SEM' ? 'mid' : 'compre'}`;
                  return (
                    <>
                      <td key={`${base}-date`} className="py-2 pr-3">
                        <Input
                          id={`${idBase}-date`}
                          name={`${base}-date`}
                          type="date"
                          defaultValue={cell.date}
                          className="h-8 w-40"
                          aria-label={`Slot ${s.slotNo} ${k.label} date`}
                        />
                      </td>
                      <td key={`${base}-start`} className="py-2 pr-3">
                        <Input
                          id={`${idBase}-start`}
                          name={`${base}-start`}
                          type="time"
                          defaultValue={cell.startTime}
                          className="h-8 w-28"
                          aria-label={`Slot ${s.slotNo} ${k.label} start`}
                        />
                      </td>
                      <td key={`${base}-end`} className="py-2 pr-3">
                        <Input
                          id={`${idBase}-end`}
                          name={`${base}-end`}
                          type="time"
                          defaultValue={cell.endTime}
                          className="h-8 w-28"
                          aria-label={`Slot ${s.slotNo} ${k.label} end`}
                        />
                      </td>
                    </>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="dibba-exam-dates-submit">
          {pending ? 'Saving…' : 'Save exam dates'}
        </Button>
        {error && (
          <span
            className="text-destructive text-sm"
            role="alert"
            data-testid="dibba-exam-dates-error"
          >
            {error}
          </span>
        )}
        {done && (
          <span className="text-sm text-emerald-700" data-testid="dibba-exam-dates-done">
            {done}
          </span>
        )}
      </div>
    </form>
  );
}
