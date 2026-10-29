import type { GridSlot } from '@hmp/db/src/dibba-schedule';

const DAYS = ['FRI', 'SAT', 'SUN'] as const;
const SESSIONS = [
  { key: 'FN', label: 'Forenoon' },
  { key: 'AN', label: 'Afternoon' },
  { key: 'EV', label: 'Evening' },
] as const;
const DAY_LABEL: Record<(typeof DAYS)[number], string> = {
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

/** Fri/Sat/Sun × FN/AN/EV (plan D6). A cell with two courses carries data-clash. */
export function WeekGrid({ grid }: { grid: GridSlot[] }) {
  const bySlot = new Map(grid.map((g) => [`${g.day}|${g.session}`, g] as const));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid="faculty-schedule-grid">
        <thead>
          <tr>
            <th className="text-muted-foreground w-24 py-2 text-left text-xs font-medium"></th>
            {SESSIONS.map((s) => (
              <th key={s.key} className="text-muted-foreground py-2 text-left text-xs font-medium">
                {s.label} ({s.key})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => (
            <tr key={day} className="border-t">
              <th className="py-3 pr-3 text-left align-top text-sm font-medium">
                {DAY_LABEL[day]}
              </th>
              {SESSIONS.map((s) => {
                const cell = bySlot.get(`${day}|${s.key}`);
                return (
                  <td
                    key={s.key}
                    className={`p-2 align-top ${cell ? '' : 'text-muted-foreground'}`}
                    data-testid={`faculty-schedule-cell-${day}-${s.key}`}
                    data-clash={cell?.clash ? 'true' : undefined}
                  >
                    {cell ? (
                      <div
                        className={`min-h-16 rounded-md border p-2 ${
                          cell.clash
                            ? 'border-red-300 bg-red-50'
                            : cell.codes.length
                              ? 'border-emerald-300 bg-emerald-50'
                              : 'bg-muted/30'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono">SL{cell.slotNo}</span>
                          <span className="text-muted-foreground">
                            {cell.startTime
                              ? `${cell.startTime}–${cell.endTime ?? ''}`
                              : 'Time not set'}
                          </span>
                        </div>
                        {cell.codes.length > 0 ? (
                          <ul className="mt-1 space-y-0.5 font-mono text-xs">
                            {cell.codes.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-muted-foreground mt-1 text-xs">No class</p>
                        )}
                        {cell.clash && (
                          <p className="mt-1 text-xs font-medium text-red-700">
                            Clash: two courses in this slot
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="min-h-16 p-2 text-xs">No class</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
