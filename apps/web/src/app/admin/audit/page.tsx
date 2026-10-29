import Link from 'next/link';
import { prisma } from '@hmp/db';
import {
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
import { formatDateTime } from '@/lib/format-date';
import { actionSentence, entityLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: { page?: string } }) {
  const page = Math.max(1, Number(searchParams.page ?? '1'));
  const [total, logs] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        actor: { select: { email: true, name: true } },
        request: { select: { refNo: true } },
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Everything people did in the portal, newest first. Page {page} of {totalPages} · {total}{' '}
          entries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing has been recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>By</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(l.createdAt)}
                  </TableCell>
                  <TableCell>{l.actor?.name ?? l.actor?.email ?? 'Automatic'}</TableCell>
                  <TableCell>{actionSentence(l.action)}</TableCell>
                  <TableCell>
                    {entityLabel(l.entity)}
                    {l.request?.refNo ? (
                      <span className="text-muted-foreground"> · {l.request.refNo}</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {totalPages > 1 && (
          <div className="mt-4 flex justify-between text-sm">
            {page > 1 ? (
              <Link href={`/admin/audit?page=${page - 1}`} className="underline underline-offset-4">
                ← Previous page
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link href={`/admin/audit?page=${page + 1}`} className="underline underline-offset-4">
                Next page →
              </Link>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
