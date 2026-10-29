'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label } from '@hmp/ui';
import {
  commitImportAction,
  previewImportAction,
  type ImportKind,
  type PreviewResult,
} from './actions';

const KIND_OPTIONS: Array<{ value: ImportKind; label: string; columns: string }> = [
  { value: 'courses', label: 'Courses', columns: 'code,title,credits,description' },
  {
    value: 'programmes',
    label: 'Programmes + Semesters',
    columns:
      'programme_code,programme_name,semester_name,year,term,start_date,end_date,exam_date,ec1_deadline',
  },
  {
    value: 'offerings',
    label: 'Course Offerings',
    columns: 'programme_code,semester_name,course_code,slot_info',
  },
  {
    value: 'slot_bookings',
    label: 'Slot Bookings (class + exam)',
    columns:
      'programme_code,semester_name,course_code,slot_type,slot,day_of_week,start_time,end_time,room',
  },
];

/** The first rows of a preview as a small table (not raw data). */
function SampleTable({ rows }: { rows: unknown[] }) {
  const records = rows
    .slice(0, 5)
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (records.length === 0) return null;
  const columns = Object.keys(records[0]!);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="border-b px-2 py-1">
                  {r[c] == null ? '' : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CsvImporter() {
  const [kind, setKind] = useState<ImportKind>('courses');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<{ imported: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  const expected = KIND_OPTIONS.find((o) => o.value === kind)!.columns;
  const kindLabel = KIND_OPTIONS.find((o) => o.value === kind)!.label;

  const handlePreview = () => {
    setError(null);
    setCommitted(null);
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('csv', csv);
    startTransition(async () => {
      const r = await previewImportAction(fd);
      setPreview(r);
    });
  };

  const handleCommit = () => {
    setShowConfirm(false);
    setError(null);
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('csv', csv);
    startTransition(async () => {
      const r = await commitImportAction(fd);
      if (!r.ok) {
        setError(r.error ?? 'Import failed');
      } else {
        setCommitted({ imported: r.imported ?? 0 });
        setPreview(null);
        setCsv('');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV importer</CardTitle>
        <CardDescription>
          Preview checks every row. Import then adds new records and updates matching ones in one
          step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Dataset</Label>
          <select
            className="bg-background h-9 w-full max-w-sm rounded-md border px-2 text-sm"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              setPreview(null);
              setCommitted(null);
            }}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">Expected columns: {expected}</p>
        </div>
        <div className="grid gap-2">
          <Label>CSV content</Label>
          <textarea
            className="bg-background min-h-[180px] w-full rounded-md border p-2 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={expected}
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handlePreview}
            disabled={pending || csv.trim().length === 0}
            variant="outline"
          >
            Preview
          </Button>
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={pending || !preview?.ok || preview.count === 0}
          >
            Import {preview?.ok ? `${preview.count} rows` : ''}
          </Button>
        </div>
        {showConfirm && preview?.ok && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-confirm-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowConfirm(false);
            }}
          >
            <div className="glass-modal w-full max-w-md p-6">
              <h3
                id="csv-confirm-title"
                className="mb-2"
                style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 600 }}
              >
                Confirm import
              </h3>
              <p className="mb-4 text-sm" style={{ color: 'var(--ink-2)' }}>
                You are about to import <strong>{preview.count}</strong> row
                {preview.count === 1 ? '' : 's'} as <strong>{kindLabel}</strong>. New records will
                be added and matching records will be updated.
              </p>
              <p className="mb-4 text-xs" style={{ color: 'var(--muted)' }}>
                This action cannot be undone. Make sure your CSV is correct before continuing.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={handleCommit} disabled={pending}>
                  {pending ? 'Importing…' : 'Confirm import'}
                </Button>
              </div>
            </div>
          </div>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {committed && (
          <p className="text-sm text-emerald-600">Imported {committed.imported} rows.</p>
        )}
        {preview && (
          <div className="bg-muted/30 rounded-md border p-3 text-xs">
            <div className="mb-2 font-medium">
              {preview.ok
                ? `All ${preview.count} rows look fine. The first few are shown below.`
                : `${preview.errors.length} rows have problems. Fix them in the file and preview again.`}
            </div>
            {preview.errors.length > 0 && (
              <ul className="text-destructive mb-2 list-disc space-y-1 pl-4">
                {preview.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    Row {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}
            {preview.sample.length > 0 && <SampleTable rows={preview.sample} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
