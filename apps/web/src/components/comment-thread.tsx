import { prisma } from '@hmp/db';
import { CommentForm } from './comment-form';
import { roleLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';

export async function CommentThread({
  handoutId,
  requestId,
}: {
  handoutId: string;
  requestId: string;
}) {
  const comments = await prisma.comment.findMany({
    where: { handoutId },
    orderBy: { createdAt: 'asc' },
    include: {
      author: {
        select: {
          name: true,
          email: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      },
    },
  });

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const primaryRole = c.author.roles[0]?.role.name ?? '—';
            return (
              <li key={c.id} className="bg-muted/30 rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {c.author.name}{' '}
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      {roleLabel(primaryRole)}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">{formatDateTime(c.createdAt)}</div>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            );
          })}
        </ul>
      )}
      <CommentForm requestId={requestId} />
    </div>
  );
}
