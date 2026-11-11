'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Label } from '@hmp/ui';
import { addCommentAction } from '@/app/(shared)/comment-actions';

export interface MentionPerson {
  id: string;
  name: string;
  role: string;
}

/**
 * A comment, or (v1.4.2) a reply to one. Typing "@" suggests the people on this request (H22); picking one
 * writes "@Name" — that person gets a notice and an email.
 */
export function CommentForm({
  requestId,
  parentId,
  people = [],
  onDone,
}: {
  requestId: string;
  parentId?: string;
  people?: MentionPerson[];
  onDone?: () => void;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [caret, setCaret] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const id = parentId ? `reply-${parentId}` : 'comment-body';

  // The "@word" being typed right before the caret, if any.
  const query = useMemo(() => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(body.slice(0, caret));
    return m ? m[2]! : null;
  }, [body, caret]);
  const matches =
    query == null
      ? []
      : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const pick = (p: MentionPerson) => {
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setCaret(before.length);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(before.length, before.length);
    });
  };

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('body', body);
    if (parentId) fd.set('parentId', parentId);
    startTransition(async () => {
      const r = await addCommentAction(fd);
      if (r?.error) setError(r.error);
      else {
        setBody('');
        onDone?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="relative space-y-2" data-testid={parentId ? 'reply-form' : 'comment-form'}>
      <Label htmlFor={id}>{parentId ? 'Reply' : 'Add a comment'}</Label>
      <textarea
        id={id}
        ref={ref}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            pick(matches[0]!);
          }
        }}
        placeholder={
          people.length
            ? 'Visible to everyone on this request. Type @ to mention someone.'
            : 'Visible to IC, HOG, PC, assigned faculty and the SME.'
        }
        className="bg-background min-h-[80px] w-full rounded-md border p-2 text-sm"
        data-testid={parentId ? 'reply-body' : 'comment-body'}
      />
      {matches.length ? (
        <ul
          className="absolute z-10 mt-[-6px] w-72 rounded-md border bg-white text-sm shadow-md"
          role="listbox"
          data-testid="mention-list"
        >
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-slate-100"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <span>{p.name}</span>
                <span className="text-muted-foreground text-xs">{p.role}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button
          size={parentId ? 'sm' : 'default'}
          onClick={submit}
          disabled={pending || body.trim().length === 0}
        >
          {pending ? 'Posting…' : parentId ? 'Post reply' : 'Post comment'}
        </Button>
        {onDone ? (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** "Reply" under a comment: opens a reply box in place. */
export function ReplyButton({
  requestId,
  parentId,
  people,
}: {
  requestId: string;
  parentId: string;
  people: MentionPerson[];
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="text-xs underline" onClick={() => setOpen(true)} data-testid="reply-open">
        Reply
      </button>
    );
  return (
    <CommentForm
      requestId={requestId}
      parentId={parentId}
      people={people}
      onDone={() => setOpen(false)}
    />
  );
}
