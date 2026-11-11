import { prisma } from '@hmp/db';
import { CommentForm, ReplyButton } from './comment-form';
import { roleLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';
import { peopleOnRequest } from '@/lib/comment-people';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Comments on a request; v1.4.2: replies sit under the comment they answer, @mentions are highlighted. */
export async function CommentThread({
  handoutId,
  requestId,
}: {
  handoutId: string;
  requestId: string;
}) {
  const [comments, people] = await Promise.all([
    prisma.comment.findMany({
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
    }),
    peopleOnRequest(requestId),
  ]);
  const top = comments.filter((c) => !c.parentId || !comments.some((p) => p.id === c.parentId));
  const repliesTo = (id: string) => comments.filter((c) => c.parentId === id);
  const names = people.map((p) => p.name).sort((a, b) => b.length - a.length);
  const mentionRe = names.length
    ? new RegExp(`(@(?:${names.map(escapeRe).join('|')}))`, 'g')
    : null;

  /** Bold "@Name" for people on the request. */
  const withMentions = (text: string) =>
    mentionRe
      ? text.split(mentionRe).map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="text-sky-900">
              {part}
            </strong>
          ) : (
            part
          ),
        )
      : text;

  const one = (c: (typeof comments)[number], reply = false) => {
    const primaryRole = c.author.roles[0]?.role.name ?? '—';
    return (
      <div
        className={reply ? 'border-l-2 pl-3' : ''}
        data-testid={reply ? 'comment-reply' : 'comment'}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="font-medium">
            {c.author.name}{' '}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              {roleLabel(primaryRole)}
            </span>
          </div>
          <div className="text-muted-foreground text-xs">{formatDateTime(c.createdAt)}</div>
        </div>
        <p className="whitespace-pre-wrap">{withMentions(c.body)}</p>
      </div>
    );
  };

  return (
    <div className="space-y-4" id="comments">
      {top.length === 0 ? (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {top.map((c) => (
            <li key={c.id} className="bg-muted/30 space-y-2 rounded-md border p-3 text-sm">
              {one(c)}
              {repliesTo(c.id).map((r) => (
                <div key={r.id}>{one(r, true)}</div>
              ))}
              <ReplyButton requestId={requestId} parentId={c.id} people={people} />
            </li>
          ))}
        </ul>
      )}
      <CommentForm requestId={requestId} people={people} />
    </div>
  );
}
