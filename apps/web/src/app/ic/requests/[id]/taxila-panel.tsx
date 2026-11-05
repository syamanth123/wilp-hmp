'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { checkTaxilaAction, publishTaxilaAction } from './actions';

type CheckReply = Awaited<ReturnType<typeof checkTaxilaAction>>;
type CheckView = Extract<CheckReply, { ok: true }>['view'];
type PublishReply = Awaited<ReturnType<typeof publishTaxilaAction>>;
type Outcome = Extract<PublishReply, { ok: true }>['outcome'];

const box = {
  ok: 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-950',
  warn: 'rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950',
  bad: 'rounded-md border border-red-300 bg-red-50 p-3 text-red-950',
};

/**
 * Mode C (v1.3.0): Check in Taxila → Publish. Nothing is uploaded by the check; Publish is enabled
 * only after a passing check and re-checks on the server before uploading.
 */
export function TaxilaPanel({
  requestId,
  defaultSemesterCode,
  semesterName,
  folderName,
}: {
  requestId: string;
  defaultSemesterCode: string;
  semesterName: string;
  folderName: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(defaultSemesterCode);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [view, setView] = useState<CheckView | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = (extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('semesterCode', code.trim());
    if (courseId) fd.set('courseId', String(courseId));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };

  const check = (pick?: number) => {
    setError(null);
    setOutcome(null);
    setView(null);
    const fd = form();
    if (pick) fd.set('courseId', String(pick));
    startTransition(async () => {
      const r = await checkTaxilaAction(fd);
      if ('error' in r) setError(r.error ?? 'Check failed.');
      else setView(r.view);
    });
  };

  const publish = (newVersion: boolean) => {
    setError(null);
    startTransition(async () => {
      const r = await publishTaxilaAction(form({ newVersion: newVersion ? '1' : '0' }));
      if ('error' in r) return setError(r.error ?? 'Publish failed.');
      setOutcome(r.outcome);
      setView(null);
      if (r.outcome.status === 'published') router.refresh();
    });
  };

  const c = view?.check;
  return (
    <div className="space-y-3 text-sm" data-testid="taxila-panel">
      <p className="text-muted-foreground">
        Publishes the approved handout as a PDF into the <strong>{folderName}</strong> folder of its
        Taxila course. Check first — nothing is uploaded until you press Publish.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="taxila-semester" className="text-muted-foreground mb-1 block text-xs">
            Taxila semester code (for {semesterName})
          </label>
          <input
            id="taxila-semester"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setView(null);
              setCourseId(null);
            }}
            placeholder="e.g. S1-26"
            className="bg-background h-9 w-32 rounded-md border px-2 font-mono"
            data-testid="taxila-semester-code"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => check()}
          disabled={pending || !code.trim()}
          data-testid="taxila-check"
        >
          {pending && !view ? 'Checking…' : 'Check in Taxila'}
        </Button>
      </div>
      {!defaultSemesterCode && (
        <p className="text-muted-foreground text-xs">
          Type the Taxila code for this semester — Summer codes aren’t confirmed yet.
        </p>
      )}

      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}

      {c && (
        <div
          className={
            c.status === 'ready' ? box.ok : c.status === 'already-there' ? box.warn : box.bad
          }
          data-testid="taxila-check-result"
          data-status={c.status}
          role="status"
        >
          {(c.status === 'ready' ||
            c.status === 'already-there' ||
            c.status === 'folder-missing') && (
            <p>
              Course: <strong>{c.course.fullname}</strong>{' '}
              <a href={c.courseUrl} target="_blank" rel="noreferrer" className="underline">
                Open in Taxila ↗
              </a>
            </p>
          )}
          {(c.status === 'ready' || c.status === 'already-there') && (
            <>
              <p>
                Folder: <strong>General › {folderName}</strong> ({c.folder.files.length}{' '}
                {c.folder.files.length === 1 ? 'file' : 'files'} in it)
              </p>
              <p>
                File: <span className="font-mono">{view!.fileName}</span>
              </p>
            </>
          )}
          <p className="mt-1 font-medium">{c.message}</p>
          {c.status === 'not-found' && (
            <p className="mt-1 text-xs">
              Check the semester code, and that the course exists in Taxila for this semester.
            </p>
          )}
          {c.status === 'folder-missing' && (
            <p className="mt-1 text-xs">
              Create a folder named “{folderName}” in the course’s General section, then check
              again.
            </p>
          )}
          {c.status === 'ambiguous' && (
            <fieldset className="mt-2 space-y-1">
              <legend className="text-xs">Pick the right course:</legend>
              {c.courses.map((x) => (
                <label key={x.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="taxila-course"
                    checked={courseId === x.id}
                    onChange={() => {
                      setCourseId(x.id);
                      check(x.id);
                    }}
                  />
                  {x.fullname}
                </label>
              ))}
            </fieldset>
          )}
          {c.status === 'ready' && (
            <Button
              className="mt-2"
              onClick={() => publish(false)}
              disabled={pending}
              data-testid="taxila-publish"
            >
              {pending ? 'Publishing…' : 'Publish to Taxila'}
            </Button>
          )}
          {c.status === 'already-there' && view!.newVersionName && (
            <div className="mt-2 space-y-1">
              <p className="text-xs">
                Nothing will be uploaded unless you publish a new version. It is added beside the
                existing file as “{view!.newVersionName}”.
              </p>
              <Button
                variant="outline"
                onClick={() => publish(true)}
                disabled={pending}
                data-testid="taxila-new-version"
              >
                {pending ? 'Publishing…' : 'Publish as new version'}
              </Button>
            </div>
          )}
        </div>
      )}

      {outcome && (
        <div
          className={
            outcome.status === 'published'
              ? box.ok
              : outcome.status === 'already-there'
                ? box.warn
                : box.bad
          }
          data-testid="taxila-outcome"
          data-status={outcome.status}
          role="status"
        >
          <p className="font-medium">{outcome.message}</p>
          {outcome.courseUrl && (
            <a href={outcome.courseUrl} target="_blank" rel="noreferrer" className="underline">
              Open the course in Taxila ↗
            </a>
          )}
          {outcome.status !== 'published' && (
            <p className="mt-1 text-xs">
              The handout is still approved, not published. Check again once it’s fixed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
