import { prisma, RoleName, type CorpusExtractionMethod } from '@hmp/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { requireRole, getSessionUser } from '@hmp/auth';
import { RunImportForm } from './run-import-form';
import { RowActions } from './row-actions';
import { BulkApproveWidget } from './bulk-approve-widget';
import { basename } from 'node:path';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const METHOD_TONE: Record<CorpusExtractionMethod, 'success' | 'neutral' | 'warning' | 'error'> = {
  MAMMOTH_STRUCTURED: 'success',
  TEXT_FALLBACK: 'warning',
  FAILED: 'error',
  SKIPPED_MODULE: 'neutral',
  SKIPPED_SIZE: 'neutral',
  SKIPPED_FORMAT: 'neutral',
  SKIPPED_NARRATIVE_PROSE: 'neutral',
};

const ALL_METHODS: CorpusExtractionMethod[] = [
  'MAMMOTH_STRUCTURED',
  'TEXT_FALLBACK',
  'FAILED',
  'SKIPPED_MODULE',
  'SKIPPED_SIZE',
  'SKIPPED_FORMAT',
  'SKIPPED_NARRATIVE_PROSE',
];

interface PageProps {
  searchParams?: {
    method?: string;
    approved?: string;
    prefix?: string;
  };
}

export default async function AdminCorpusImportsPage({ searchParams }: PageProps) {
  await requireRole(await getSessionUser(), RoleName.ADMIN);

  const methodFilter = searchParams?.method as CorpusExtractionMethod | undefined;
  const approvedFilter = searchParams?.approved;
  const prefixFilter = (searchParams?.prefix ?? '').toUpperCase().trim();

  const where: Record<string, unknown> = {};
  if (methodFilter && ALL_METHODS.includes(methodFilter)) where.extractionMethod = methodFilter;
  if (approvedFilter === 'yes') where.approvedForReuse = true;
  if (approvedFilter === 'no') where.approvedForReuse = false;
  if (prefixFilter) where.bitsCourseNumber = { startsWith: prefixFilter };

  // Aggregate counts for the header pills, independent of filter (always show total breakdown).
  const total = await prisma.handoutImport.count();
  const byMethodRaw = await prisma.handoutImport.groupBy({
    by: ['extractionMethod'],
    _count: true,
  });
  const byMethod = Object.fromEntries(byMethodRaw.map((r) => [r.extractionMethod, r._count]));

  // 11f-b2: approved-count badge for admin progress signal.
  const approvedCount = await prisma.handoutImport.count({ where: { approvedForReuse: true } });

  const rows = await prisma.handoutImport.findMany({
    where,
    orderBy: [{ extractionMethod: 'asc' }, { sourceFile: 'asc' }],
    take: 500,
  });

  // 11f-b2 Course-row reconciliation: which course codes do NOT have a
  // matching Course row in the DB? Show a "create it?" link on those.
  const courseNumbersInPage = Array.from(
    new Set(rows.map((r) => r.bitsCourseNumber).filter((c): c is string => !!c)),
  );
  const matchingCourses = courseNumbersInPage.length
    ? await prisma.course.findMany({
        where: {
          OR: [
            { bitsCourseNumber: { in: courseNumbersInPage } },
            { alternateCodes: { hasSome: courseNumbersInPage } },
          ],
        },
        select: { bitsCourseNumber: true, alternateCodes: true },
      })
    : [];
  const knownCourseCodes = new Set(
    matchingCourses.flatMap((c) => [c.bitsCourseNumber, ...c.alternateCodes]),
  );

  const defaultCorpusPath = process.env.HMP_CORPUS_DIR ?? '';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Corpus imports</CardTitle>
          <CardDescription>
            BITS handout corpus ingestion (Prompts 11f-a + 11f-b1 + 11f-b2). Each row is one source
            `.docx` parsed by <code>parseDocxToHandout</code>; rows are upserted by `sourceFile` so
            re-running the import is idempotent. Approved rows surface to faculty via auto- fetch
            Tier 2 (Prompt 11f-b2).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RunImportForm defaultPath={defaultCorpusPath} />
          <div className="border-t pt-3">
            <BulkApproveWidget />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Imported handouts ({total.toLocaleString()}) ·{' '}
            <span className="text-emerald-700" data-testid="corpus-approved-count">
              {approvedCount.toLocaleString()} approved
            </span>{' '}
            ({total > 0 ? Math.round((approvedCount / total) * 100) : 0}%)
          </CardTitle>
          <CardDescription>
            Filter by extraction method, approval state, or course-code prefix via the URL search
            params (e.g. <code>?method=FAILED</code>, <code>?prefix=EE</code>,{' '}
            <code>?approved=yes</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2" data-testid="corpus-method-counts">
            {ALL_METHODS.map((m) => {
              const count = byMethod[m] ?? 0;
              return (
                <a
                  key={m}
                  href={`/admin/corpus-imports?method=${m}`}
                  className="rounded-full border px-3 py-1 text-xs hover:bg-slate-50"
                >
                  <span className="font-mono">{m}</span>
                  <span className="ml-2 font-semibold">{count}</span>
                </a>
              );
            })}
            <a
              href="/admin/corpus-imports"
              className="rounded-full border px-3 py-1 text-xs hover:bg-slate-50"
            >
              All <span className="ml-2 font-semibold">{total}</span>
            </a>
          </div>

          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No imports match this filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Warnings / Errors</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid={`corpus-row-${r.id}`}>
                    <TableCell className="font-mono text-xs">
                      {basename(r.sourceFile)}
                      <div className="text-muted-foreground">
                        {(r.sourceFileBytes / 1024).toFixed(0)} KB
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.bitsCourseNumber ?? <span className="text-muted-foreground">—</span>}
                      {r.alternateCodes.length > 0 && (
                        <div className="text-muted-foreground">+{r.alternateCodes.join(', ')}</div>
                      )}
                      {r.bitsCourseNumber && !knownCourseCodes.has(r.bitsCourseNumber) && (
                        <Link
                          href={`/admin/programmes?prefillCode=${encodeURIComponent(r.bitsCourseNumber)}${
                            (r.data as { partA?: { courseTitle?: string } } | null)?.partA
                              ?.courseTitle
                              ? `&prefillTitle=${encodeURIComponent((r.data as { partA: { courseTitle: string } }).partA.courseTitle ?? '')}`
                              : ''
                          }`}
                          className="mt-1 inline-block text-[11px] text-blue-700 underline"
                          data-testid="corpus-row-create-course-link"
                        >
                          Course row not found — create it?
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <MethodBadge method={r.extractionMethod} />
                    </TableCell>
                    <TableCell>
                      {r.data ? (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                          ✓
                        </Badge>
                      ) : (
                        <Badge variant="outline">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.parseWarnings.length > 0 && (
                        <div className="text-amber-700">⚠ {r.parseWarnings.length}</div>
                      )}
                      {r.parseErrors.length > 0 && (
                        <div className="text-red-700">✗ {r.parseErrors.length}</div>
                      )}
                      {(r.parseWarnings[0] ?? r.parseErrors[0]) && (
                        <div
                          className="text-muted-foreground mt-1 max-w-xs truncate"
                          title={[...r.parseWarnings, ...r.parseErrors].join('\n')}
                        >
                          {r.parseWarnings[0] ?? r.parseErrors[0]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {r.importedAt.toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <RowActions id={r.id} approvedForReuse={r.approvedForReuse} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MethodBadge({ method }: { method: CorpusExtractionMethod }) {
  const tone = METHOD_TONE[method];
  const className =
    tone === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : tone === 'error'
          ? 'border-red-300 bg-red-50 text-red-700'
          : 'border-slate-300 bg-slate-50 text-slate-700';
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${className}`}>
      {method}
    </Badge>
  );
}
