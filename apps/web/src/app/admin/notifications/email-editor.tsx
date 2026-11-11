'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import {
  previewEmailAction,
  saveWordingAction,
  sendTestAction,
  type WordingInput,
} from './actions';

type Msg = { ok: boolean; text: string } | null;

function Note({ m }: { m: Msg }) {
  if (!m) return null;
  return (
    <p
      className={`text-sm ${m.ok ? 'text-emerald-800' : 'text-red-700'}`}
      role={m.ok ? 'status' : 'alert'}
    >
      {m.text}
    </p>
  );
}

/**
 * v1.4.3 (§4, H29): edit one email's subject, summary and "what to do"; see it as it would be sent, with a
 * real request; send a test to yourself. The rest of the email (due date, button, details, people, recent
 * steps, footer) is fixed.
 */
export function EmailEditor({
  emailKey,
  label,
  to,
  needsRequest,
  original,
  current,
  edited,
  placeholders,
  requests,
}: {
  emailKey: string;
  label: string;
  to: string;
  needsRequest: boolean;
  original: WordingInput;
  current: WordingInput;
  edited: string | null;
  placeholders: { name: string; text: string }[];
  requests: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [w, setW] = useState<WordingInput>(current);
  const [requestId, setRequestId] = useState(requests[0]?.id ?? '');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [testMsg, setTestMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const last = useRef<keyof WordingInput>('summary');

  const show = (words: WordingInput, req: string) =>
    start(async () => {
      const r = await previewEmailAction(emailKey, req || null, words);
      if (r.ok) setPreview({ subject: r.subject, html: r.html });
      else setMsg({ ok: false, text: r.error });
    });
  useEffect(() => {
    show(current, requests[0]?.id ?? '');
    // Once, on opening.
  }, []);

  const field = 'bg-background w-full rounded-md border px-2 py-1.5 text-sm';
  const changed =
    w.subject !== current.subject || w.summary !== current.summary || w.action !== current.action;
  const insert = (name: string) => {
    const f = last.current;
    setW((x) => ({ ...x, [f]: `${x[f]}${x[f] && !x[f].endsWith(' ') ? ' ' : ''}{{${name}}}` }));
  };

  return (
    <div className="space-y-4" data-testid="email-editor">
      <div>
        <h3 className="text-base font-semibold">
          {label} <span className="text-muted-foreground font-normal">— to {to}</span>
        </h3>
        <p className="text-muted-foreground text-xs">
          {edited ? `Edited: ${edited}.` : 'The original wording.'} Only these three parts can be
          changed; the due date, button, details, people, recent steps and footer are always there.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Subject</span>
            <input
              className={field}
              value={w.subject}
              onFocus={() => (last.current = 'subject')}
              onChange={(e) => setW({ ...w, subject: e.target.value })}
              data-testid="wording-subject"
            />
            <span className="text-muted-foreground text-xs">
              “[HMP]” goes in front; when the reader has to act, “— due …” goes after.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Summary (the first line)</span>
            <textarea
              className={field}
              rows={3}
              value={w.summary}
              onFocus={() => (last.current = 'summary')}
              onChange={(e) => setW({ ...w, summary: e.target.value })}
              data-testid="wording-summary"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">What to do</span>
            <textarea
              className={field}
              rows={3}
              value={w.action}
              onFocus={() => (last.current = 'action')}
              onChange={(e) => setW({ ...w, action: e.target.value })}
              data-testid="wording-action"
            />
          </label>
          <div className="text-sm">
            <div className="mb-1 font-medium">
              Placeholders (click to add to the field you were in)
            </div>
            <ul className="flex flex-wrap gap-1.5" data-testid="wording-placeholders">
              {placeholders.map((p) => (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => insert(p.name)}
                    className="hover:bg-muted rounded border px-1.5 py-0.5 font-mono text-xs"
                    title={p.text}
                  >
                    {`{{${p.name}}}`}
                  </button>{' '}
                  <span className="text-muted-foreground text-xs">{p.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !changed}
              onClick={() =>
                start(async () => {
                  const r = await saveWordingAction(emailKey, w);
                  setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
                  if (r.ok) router.refresh();
                })
              }
              data-testid="wording-save"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setW(original);
                show(original, requestId);
                setMsg({
                  ok: true,
                  text: 'The original wording is back on screen — Save to keep it.',
                });
              }}
              data-testid="wording-original"
            >
              Back to the original wording
            </Button>
          </div>
          <Note m={msg} />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            {needsRequest ? (
              <label className="text-sm">
                <span className="mb-1 block font-medium">Preview with</span>
                <select
                  className="bg-background h-9 max-w-xs rounded-md border px-2 text-sm"
                  value={requestId}
                  onChange={(e) => {
                    setRequestId(e.target.value);
                    show(w, e.target.value);
                  }}
                  data-testid="preview-request"
                >
                  {requests.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-muted-foreground text-sm">Preview with your own account.</span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => show(w, requestId)}
              data-testid="preview-refresh"
            >
              Show the preview
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setTestMsg(null);
                  const r = await sendTestAction(emailKey, requestId || null, w);
                  setTestMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
                })
              }
              data-testid="send-test"
            >
              Send a test to me
            </Button>
          </div>
          <Note m={testMsg} />
          {preview ? (
            <div className="overflow-hidden rounded-md border" data-testid="email-preview">
              <div className="bg-muted border-b px-3 py-2 text-sm" data-testid="preview-subject">
                <span className="text-muted-foreground">Subject:</span> {preview.subject}
              </div>
              <iframe
                title="Email preview"
                srcDoc={preview.html}
                sandbox=""
                className="h-[900px] w-full bg-white"
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {pending ? 'Building the preview…' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
