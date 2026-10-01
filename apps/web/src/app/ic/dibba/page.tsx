import Link from 'next/link';
import { prisma, RoleName, DibbaImportStatus } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { CreateTermForm } from './create-term-form';
import { UploadDibbaForm } from './upload-form';
import { DiscardDraftButton } from './discard-button';
import { fmtDate, fmtDateTime, fmtInt } from './format';

export const dynamic = 'force-dynamic';

/**
 * /ic/dibba — terms, imports (draft / published / superseded), upload
 * (Course Dibba Phase 3, docs/plans/phase-3-course-dibba.md §1). Reads only;
 * the mutations live in actions.ts and the upload Route Handler.
 */

const STATUS_BADGE: Record<
  DibbaImportStatus,
  { variant: 'secondary' | 'success' | 'outline'; label: string }
> = {
  DRAFT: { variant: 'secondary', label: 'Draft' },
  PUBLISHED: { variant: 'success', label: 'Published' },
  SUPERSEDED: { variant: 'outline', label: 'Superseded' },
};

export default async function ICDibbaPage() {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const terms = await prisma.academicTerm.findMany({
    orderBy: [{ year: 'desc' }, { term: 'asc' }],
    select: {
      id: true,
      name: true,
      year: true,
      term: true,
      startDate: true,
      endDate: true,
      imports: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          label: true,
          sourceFilename: true,
          sourceFormat: true,
          status: true,
          rowCount: true,
          warnings: true,
          publishedAt: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Terms</CardTitle>
          <CardDescription>
            A term is the whole semester across all programmes — one Course Dibba is published per
            term. Creating a term also seeds its 8 standard class slots (SL1–SL8).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Term</TableHead>
                <TableHead>Year / term</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Published Dibba</TableHead>
                <TableHead>Drafts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    No terms yet — create one below, then upload its Dibba.
                  </TableCell>
                </TableRow>
              ) : (
                terms.map((t) => {
                  const published = t.imports.find((i) => i.status === DibbaImportStatus.PUBLISHED);
                  const drafts = t.imports.filter(
                    (i) => i.status === DibbaImportStatus.DRAFT,
                  ).length;
                  return (
                    <TableRow key={t.id} data-testid={`dibba-term-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {t.year} {t.term}
                      </TableCell>
                      <TableCell className="text-xs">
                        {fmtDate.format(t.startDate)} – {fmtDate.format(t.endDate)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {published ? (
                          <>
                            {published.label}{' '}
                            <span className="text-muted-foreground text-xs">
                              ({published.publishedAt ? fmtDate.format(published.publishedAt) : '—'}
                              )
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </TableCell>
                      <TableCell>{drafts}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-medium">Create term</p>
            <CreateTermForm />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload a Course Dibba</CardTitle>
          <CardDescription>
            Word (.doc / .docx) or Excel (.xlsx). The file is converted and parsed on the server and
            saved as a <strong>draft</strong>; you then review the preview (counts, warnings, codes
            not in the catalogue) and publish. Re-uploading creates a new draft.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDibbaForm terms={terms.map((t) => ({ id: t.id, name: t.name }))} />
        </CardContent>
      </Card>

      {terms.map((t) => (
        <Card key={t.id}>
          <CardHeader>
            <CardTitle className="text-base">Imports — {t.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {t.imports.length === 0 ? (
              <p className="text-muted-foreground text-sm">No Dibba uploaded yet for this term.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Warnings</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.imports.map((i) => {
                    const badge = STATUS_BADGE[i.status];
                    return (
                      <TableRow key={i.id} data-testid={`dibba-import-${i.id}`}>
                        <TableCell className="font-medium">{i.label}</TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono">{i.sourceFilename}</span>
                          <div className="text-muted-foreground uppercase">{i.sourceFormat}</div>
                        </TableCell>
                        <TableCell>{fmtInt.format(i.rowCount)}</TableCell>
                        <TableCell>
                          {i.warnings.length > 0 ? (
                            <span className="text-amber-700">⚠ {i.warnings.length}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} data-testid={`dibba-status-${i.id}`}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {i.publishedAt ? fmtDateTime.format(i.publishedAt) : '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {fmtDateTime.format(i.createdAt)}
                          <div className="text-muted-foreground">{i.uploadedBy.name}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Link
                              href={`/ic/dibba/${i.id}`}
                              className="text-primary text-sm underline-offset-4 hover:underline"
                              data-testid={`dibba-open-${i.id}`}
                            >
                              {i.status === DibbaImportStatus.DRAFT ? 'Preview' : 'View'}
                            </Link>
                            {i.status === DibbaImportStatus.DRAFT && (
                              <DiscardDraftButton importId={i.id} label={i.label} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
