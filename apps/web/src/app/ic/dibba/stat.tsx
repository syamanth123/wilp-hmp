import { fmtInt } from './format';

/** Count tile (the admin/import page's file-local Stat, with locale-formatted values). */
export function Stat({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="rounded-md border p-3" data-testid={testId}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold">{fmtInt.format(value)}</div>
    </div>
  );
}
