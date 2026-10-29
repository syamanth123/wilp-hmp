import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { CsvImporter } from './csv-importer';
import { formatDateTime } from '@/lib/format-date';

const KIND_LABEL: Record<string, string> = {
  courses: 'Courses',
  programmes: 'Programmes and semesters',
  offerings: 'Course offerings',
  slot_bookings: 'Slot bookings',
};

export default async function AdminImportPage() {
  const [programmes, semesters, courses, offerings, snapshots] = await Promise.all([
    prisma.programme.count(),
    prisma.semester.count(),
    prisma.course.count(),
    prisma.courseOffering.count(),
    prisma.erpSnapshot.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Import academic data</CardTitle>
          <CardDescription>Load programmes, courses and offerings from a CSV file.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-3 text-sm">
          <Stat label="Programmes" value={programmes} />
          <Stat label="Semesters" value={semesters} />
          <Stat label="Courses" value={courses} />
          <Stat label="Offerings" value={offerings} />
        </CardContent>
      </Card>

      <CsvImporter />

      <Card>
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-muted-foreground text-sm">No imports yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {snapshots.map((s) => {
                const payload = s.payload as { kind?: string; count?: number } | null;
                return (
                  <li key={s.id} className="flex justify-between border-b pb-1">
                    <span>
                      <span className="font-medium">
                        {KIND_LABEL[payload?.kind ?? ''] ?? 'Import'}
                      </span>{' '}
                      — {payload?.count ?? 0} rows
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(s.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
