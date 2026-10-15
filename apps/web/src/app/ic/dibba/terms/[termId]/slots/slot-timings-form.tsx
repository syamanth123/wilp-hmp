'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@hmp/ui';
import { saveSlotTimingsAction } from './actions';

export interface SlotRow {
  slotNo: number;
  day: string;
  session: string;
  startTime: string | null;
  endTime: string | null;
}

/** Class time per slot (Phase 4, plan D4). One save for all 8 rows; only changed slots are written. */
export function SlotTimingsForm({ termId, slots }: { termId: string; slots: SlotRow[] }) {
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
          const res = await saveSlotTimingsAction(fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          setDone(
            res.changed.length === 0
              ? 'Nothing changed.'
              : `Saved — slot${res.changed.length === 1 ? '' : 's'} ${res.changed.join(', ')} updated.`,
          );
          router.refresh();
        });
      }}
      data-testid="dibba-slot-timings-form"
    >
      <input type="hidden" name="termId" value={termId} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-2 pr-3 font-medium">Slot</th>
            <th className="py-2 pr-3 font-medium">Day / session</th>
            <th className="py-2 pr-3 font-medium">Class time from</th>
            <th className="py-2 pr-3 font-medium">to</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.slotNo} className="border-b last:border-0">
              <td className="py-2 pr-3 font-mono">SL{s.slotNo}</td>
              <td className="py-2 pr-3">
                {s.day} {s.session}
              </td>
              <td className="py-2 pr-3">
                <Input
                  id={`slot-${s.slotNo}-start`}
                  name={`start-${s.slotNo}`}
                  type="time"
                  defaultValue={s.startTime ?? ''}
                  className="h-8 w-32"
                  aria-label={`Slot ${s.slotNo} class time start`}
                />
              </td>
              <td className="py-2 pr-3">
                <Input
                  id={`slot-${s.slotNo}-end`}
                  name={`end-${s.slotNo}`}
                  type="time"
                  defaultValue={s.endTime ?? ''}
                  className="h-8 w-32"
                  aria-label={`Slot ${s.slotNo} class time end`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="dibba-slot-timings-submit">
          {pending ? 'Saving…' : 'Save class times'}
        </Button>
        {error && (
          <span
            className="text-destructive text-sm"
            role="alert"
            data-testid="dibba-slot-timings-error"
          >
            {error}
          </span>
        )}
        {done && (
          <span className="text-sm text-emerald-700" data-testid="dibba-slot-timings-done">
            {done}
          </span>
        )}
      </div>
    </form>
  );
}
