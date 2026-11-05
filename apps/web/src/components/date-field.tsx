'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@hmp/ui';
import { formatDateInput, isoDate, parseDateInput } from '@/lib/date-input';

// One date field for the whole app: it shows and takes dd/mm/yyyy whatever the browser's
// language (a native <input type="date"> shows mm/dd/yyyy in an en-US browser), with a small
// calendar to pick from. Forms receive "YYYY-MM-DD" under `name`, as before.

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface DateFieldProps {
  id: string;
  /** Form field name; a hidden input carries "YYYY-MM-DD". */
  name?: string;
  /** Controlled value ("YYYY-MM-DD" or ''). */
  value?: string;
  defaultValue?: string;
  /** Called with "YYYY-MM-DD" (or '' when cleared) once a date is typed in full or picked. */
  onChange?: (iso: string) => void;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

function todayIso(): string {
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  return isoDate(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number];

function addDays(iso: string, n: number): string {
  const [y, m, d] = ymd(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = ymd(iso);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDate(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last));
}

export function DateField({
  id,
  name,
  value,
  defaultValue = '',
  onChange,
  required,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DateFieldProps) {
  const controlled = value !== undefined;
  const [text, setText] = useState(formatDateInput(controlled ? value : defaultValue));
  const [open, setOpen] = useState(false);
  const [focusDay, setFocusDay] = useState(todayIso());
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // A new value from outside (e.g. "Clear all") replaces what is in the box.
  useEffect(() => {
    if (controlled) setText(formatDateInput(value));
  }, [controlled, value]);

  const parsed = parseDateInput(text);
  const invalid = parsed === null;
  const iso = parsed ?? '';

  // form.reset() puts the starting date back.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const reset = () => setText(formatDateInput(controlled ? value : defaultValue));
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [controlled, value, defaultValue]);

  // Forms refuse to submit a half-typed date.
  useEffect(() => {
    input.current?.setCustomValidity(invalid ? 'Type the date as dd/mm/yyyy.' : '');
  }, [invalid]);

  const commit = (next: string) => {
    setText(formatDateInput(next));
    if (next !== (controlled ? value : null)) onChange?.(next);
  };

  // Close the calendar on a click outside it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Keyboard focus follows the highlighted day.
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay]);

  const openCalendar = () => {
    setFocusDay(iso || todayIso());
    setOpen(true);
  };
  const pick = (day: string) => {
    commit(day);
    setOpen(false);
    button.current?.focus();
  };

  const [fy, fm] = ymd(focusDay);
  const firstWeekday = new Date(Date.UTC(fy, fm - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDate(fy, fm, i + 1)),
  ];
  const today = todayIso();

  const onGridKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, -1),
      PageDown: () => addMonths(focusDay, 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setFocusDay(moves[e.key]!());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div ref={wrap} className={cn('relative', className)} data-testid={testId}>
      <div className="flex">
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          aria-label={ariaLabel}
          aria-describedby={invalid ? hintId : undefined}
          aria-invalid={invalid || undefined}
          required={required}
          value={text}
          // A filter applies on Enter or on leaving the box, so it doesn't reload on every key.
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!invalid) commit(iso);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !invalid && onChange) {
              e.preventDefault();
              commit(iso);
            }
          }}
          className={cn(
            'border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full min-w-0 rounded-l-md border bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1',
            invalid && 'border-red-600',
          )}
        />
        <button
          ref={button}
          type="button"
          onClick={() => (open ? setOpen(false) : openCalendar())}
          aria-label={`Choose a date${ariaLabel ? ` — ${ariaLabel}` : ''}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="border-input hover:bg-accent text-muted-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-r-md border border-l-0"
          data-testid="date-field-open"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm10 6H4v8h12V8Z" />
          </svg>
        </button>
      </div>
      {invalid && (
        <p id={hintId} className="mt-1 text-xs text-red-700">
          Type the date as dd/mm/yyyy, e.g. 05/12/2026.
        </p>
      )}
      {name && <input type="hidden" name={name} value={iso} />}

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="bg-card absolute left-0 top-10 z-50 w-64 rounded-md border p-2 shadow-lg"
          data-testid="date-field-calendar"
        >
          <div className="mb-2 flex items-center justify-between text-sm">
            <button
              type="button"
              className="hover:bg-accent rounded px-2 py-1"
              aria-label="Previous month"
              onClick={() => setFocusDay(addMonths(focusDay, -1))}
            >
              ‹
            </button>
            <span className="font-medium" aria-live="polite">
              {MONTH_NAMES[fm - 1]} {fy}
            </span>
            <button
              type="button"
              className="hover:bg-accent rounded px-2 py-1"
              aria-label="Next month"
              onClick={() => setFocusDay(addMonths(focusDay, 1))}
            >
              ›
            </button>
          </div>
          <div
            ref={grid}
            role="group"
            aria-label={`${MONTH_NAMES[fm - 1]} ${fy}`}
            className="grid grid-cols-7 gap-0.5 text-center text-xs"
            onKeyDown={onGridKey}
          >
            {WEEKDAYS.map((w) => (
              <span key={w} aria-hidden className="text-muted-foreground py-1">
                {w}
              </span>
            ))}
            {cells.map((day, i) =>
              day ? (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  tabIndex={day === focusDay ? 0 : -1}
                  aria-pressed={day === iso}
                  aria-current={day === today ? 'date' : undefined}
                  aria-label={`${Number(day.slice(8))} ${MONTH_NAMES[fm - 1]} ${fy}`}
                  onClick={() => pick(day)}
                  className={cn(
                    'rounded py-1.5 tabular-nums',
                    day === iso
                      ? 'bg-[var(--bits-navy)] font-semibold text-white'
                      : 'hover:bg-accent',
                    day === today && day !== iso && 'ring-1 ring-[var(--bits-navy)]',
                  )}
                >
                  {Number(day.slice(8))}
                </button>
              ) : (
                <span key={`blank-${i}`} />
              ),
            )}
          </div>
          <div className="mt-2 flex justify-between text-xs">
            <button type="button" className="underline" onClick={() => pick(today)}>
              Today
            </button>
            {iso && (
              <button type="button" className="underline" onClick={() => pick('')}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
