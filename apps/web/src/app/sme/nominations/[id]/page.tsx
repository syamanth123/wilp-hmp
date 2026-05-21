import { notFound } from 'next/navigation';
import { prisma, RoleName } from '@hmp/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { StatusBadge } from '@/components/status-badge';
import { HandoutViewer } from '@/components/handout-viewer';
import { CommentThread } from '@/components/comment-thread';
import { NominationResponsePanel } from './response-panel';

// Workflow detail pages MUST be force-dynamic for the same reason every other
// /<role>/requests/[id] page is — see ic/requests/[id]/page.tsx.
export const dynamic = 'force-dynamic';

const STATUS_BADGE_VARIANT = {
  PENDING: 'secondary',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  COMPLETED: 'outline',
} as const;

export default async function SmeNominationDetail({ params }: { params: { id: string } }) {
  const me = requireRole(await getSessionUser(), RoleName.SME);

  const nomination = await prisma.smeNomination.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      topic: true,
      notes: true,
      status: true,
      smeUserId: true,
      respondedAt: true,
      completedAt: true,
      createdAt: true,
      nominatedBy: { select: { name: true, email: true } },
      request: {
        select: {
          id: true,
          refNo: true,
          status: true,
          offering: {
            select: {
              course: { select: { code: true, title: true } },
              semester: { select: { name: true, programme: { select: { code: true } } } },
            },
          },
          handout: {
            select: {
              id: true,
              currentVersion: { select: { versionNo: true, contentHtml: true } },
            },
          },
        },
      },
    },
  });
  if (!nomination) notFound();
  // Ownership: SMEs only see their own nominations. ADMIN can see all (audit
  // path). For any other mismatch we return 404 rather than 403 — don't
  // confirm the nomination exists to non-owners.
  const isAdmin = me.roles.includes(RoleName.ADMIN);
  if (nomination.smeUserId !== me.id && !isAdmin) notFound();

  const handout = nomination.request.handout;
  const handoutHtml = handout?.currentVersion?.contentHtml ?? null;

  // Cheap pre-check to gate the Mark-complete button server-side. The helper
  // re-checks this in-transaction, so the UI hint can be optimistic.
  const smeHasCommented = handout
    ? (await prisma.comment.count({
        where: { handoutId: handout.id, authorId: me.id },
      })) > 0
    : false;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="font-mono text-base">{nomination.request.refNo}</CardTitle>
            <CardDescription>
              {nomination.request.offering.course.code} —{' '}
              {nomination.request.offering.course.title}
            </CardDescription>
            <p className="text-muted-foreground mt-1 text-xs">
              {nomination.request.offering.semester.programme.code} ·{' '}
              {nomination.request.offering.semester.name} · nominated by{' '}
              {nomination.nominatedBy.name} on{' '}
              {new Date(nomination.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={STATUS_BADGE_VARIANT[nomination.status]}>{nomination.status}</Badge>
            <StatusBadge status={nomination.request.status} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">{nomination.topic}</p>
          {nomination.notes && (
            <div>
              <h4 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                Notes
              </h4>
              <p className="text-sm whitespace-pre-wrap">{nomination.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your response</CardTitle>
          <CardDescription>
            Accept to advise; decline if you can&apos;t. Once accepted, leave at least one comment
            on the handout below and then mark complete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NominationResponsePanel
            nominationId={nomination.id}
            status={nomination.status}
            smeHasCommented={smeHasCommented}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Handout
            {handout?.currentVersion ? ` (v${handout.currentVersion.versionNo})` : ''}
          </CardTitle>
          <CardDescription>Read-only — you can advise via comments below.</CardDescription>
        </CardHeader>
        <CardContent>
          {handout ? (
            <HandoutViewer
              html={handoutHtml}
              empty="Faculty has not yet started editing this handout."
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Faculty has not yet started editing this handout.
            </p>
          )}
        </CardContent>
      </Card>

      {handout && (
        <Card>
          <CardHeader>
            <CardTitle id="comment-thread">Discussion</CardTitle>
            <CardDescription>
              {nomination.status === 'ACCEPTED'
                ? 'Add comments with your advisory input here.'
                : nomination.status === 'PENDING'
                  ? 'Accept the nomination above to participate in the discussion.'
                  : 'Read-only — this nomination is closed.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CommentThread handoutId={handout.id} requestId={nomination.request.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <dt className="text-muted-foreground">Nominated</dt>
            <dd>{new Date(nomination.createdAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Responded</dt>
            <dd>
              {nomination.respondedAt
                ? new Date(nomination.respondedAt).toLocaleString()
                : '—'}
            </dd>
            <dt className="text-muted-foreground">Completed</dt>
            <dd>
              {nomination.completedAt
                ? new Date(nomination.completedAt).toLocaleString()
                : '—'}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
