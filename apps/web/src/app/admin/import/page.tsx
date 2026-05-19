import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { CsvImporter } from './csv-importer';

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
          <CardTitle>ERP CSV import</CardTitle>
          <CardDescription>
            Bulk-load academic data from spreadsheets. Real ERP API integration replaces this in Phase 3.
          </CardDescription>
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
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {snapshots.map((s) => {
                const payload = s.payload as { kind?: string; count?: number } | null;
                return (
                  <li key={s.id} className="flex justify-between border-b pb-1">
                    <span>
                      <span className="font-medium">{payload?.kind ?? 'unknown'}</span> — {payload?.count ?? 0} rows
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </span>
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
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
