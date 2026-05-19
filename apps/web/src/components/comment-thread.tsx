import { prisma } from '@hmp/db';
import { CommentForm } from './comment-form';

export async function CommentThread({ handoutId, requestId }: { handoutId: string; requestId: string }) {
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
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const primaryRole = c.author.roles[0]?.role.name ?? '—';
            return (
              <li key={c.id} className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {c.author.name}{' '}
                    <span className="ml-1 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {primaryRole.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </div>
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
