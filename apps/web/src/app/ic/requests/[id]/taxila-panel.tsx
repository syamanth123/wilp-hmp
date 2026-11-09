'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import {
  checkTaxilaAction,
  clearTaxilaCourseAction,
  publishTaxilaAction,
  searchTaxilaCoursesAction,
} from './actions';
import { formatDateTime } from '@/lib/format-date';

type CheckReply = Awaited<ReturnType<typeof checkTaxilaAction>>;
type CheckView = Extract<CheckReply, { ok: true }>['view'];
type PublishReply = Awaited<ReturnType<typeof publishTaxilaAction>>;
type Outcome = Extract<PublishReply, { ok: true }>['outcome'];

const box = {
  ok: 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-950',
  bad: 'rounded-md border border-red-300 bg-red-50 p-3 text-red-950',
};

const ITEM = 'Course Handout';
const FILE = 'Course Handout.pdf';

/**
 * Mode C: Check in Taxila → Publish. Nothing is uploaded by the check; Publish is offered only
 * after a passing check, and the server re-checks before uploading. The file is always
 * "Course Handout.pdf" in the course's "Course Handout" item; any other file there blocks it.
 */
export function TaxilaPanel({
  requestId,
  defaultSemesterCode,
  semesterName,
}: {
  requestId: string;
  defaultSemesterCode: string;
  semesterName: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(defaultSemesterCode);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [view, setView] = useState<CheckView | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [choosing, setChoosing] = useState(false);
  // A picked course is remembered on the server (v1.4.1), so Publish never sends a course id.
  const form = () => {
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('semesterCode', code.trim());
    return fd;
  };

  /** `pick`: the IC chose a course (one of several matches, or from a search for `query`). */
  const check = (pick?: number, query?: string) => {
    setError(null);
    setOutcome(null);
    setView(null);
    const fd = form();
    if (pick) fd.set('courseId', String(pick));
    if (query) fd.set('query', query);
    startTransition(async () => {
      const r = await checkTaxilaAction(fd);
      setCourseId(null);
      if ('error' in r) setError(r.error ?? 'Check failed.');
      else {
        setView(r.view);
        setChoosing(false);
      }
    });
  };

  const clearChoice = () => {
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      await clearTaxilaCourseAction(fd);
      check();
    });
  };

  const publish = () => {
    setError(null);
    startTransition(async () => {
      const r = await publishTaxilaAction(form());
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
        Publishes the approved handout as <span className="font-mono">{FILE}</span> into the{' '}
        <strong>{ITEM}</strong> item in its Taxila course’s General section, replacing the file
        there. Check first — nothing is uploaded until you press Publish.
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
          className={c.status === 'ready' ? box.ok : box.bad}
          data-testid="taxila-check-result"
          data-status={c.status}
          role="status"
        >
          {(c.status === 'ready' || c.status === 'item-missing' || c.status === 'other-files') && (
            <p>
              Course: <strong>{c.course.fullname}</strong>{' '}
              <a href={c.courseUrl} target="_blank" rel="noreferrer" className="underline">
                Open in Taxila ↗
              </a>
            </p>
          )}
          {(c.status === 'ready' || c.status === 'other-files') && (
            <>
              <p>
                Item: <strong>General › {ITEM}</strong> — holds{' '}
                {c.item.files.length === 0
                  ? 'no file yet'
                  : c.item.files.map((f, i) => (
                      <span key={f.name}>
                        {i > 0 && ', '}
                        <span className="font-mono">{f.name}</span>
                      </span>
                    ))}
              </p>
              <p>
                File HMP uploads: <span className="font-mono">{view!.fileName}</span>
              </p>
            </>
          )}
          {view?.choice && (
            <p className="mt-1 text-xs" data-testid="taxila-choice">
              Taxila course chosen by {view.choice.chosenBy ?? 'someone'} on{' '}
              {formatDateTime(view.choice.chosenAt)} ·{' '}
              <button
                type="button"
                className="underline"
                onClick={clearChoice}
                disabled={pending}
                data-testid="taxila-choice-clear"
              >
                Use the automatic match again
              </button>
            </p>
          )}
          <p className="mt-1 font-medium">{c.message}</p>
          {c.status === 'not-found' && (
            <p className="mt-1 text-xs">
              Check the semester code, and that the course exists in Taxila for this semester.
            </p>
          )}
          {c.status === 'item-missing' && (
            <p className="mt-1 text-xs">
              In Taxila: turn editing on, add a File in General, name it “{ITEM}”, and upload any
              PDF renamed to {FILE} as the placeholder. HMP replaces it when you publish.
            </p>
          )}
          {c.status === 'other-files' && (
            <p className="mt-1 text-xs" data-testid="taxila-other-files">
              Publishing is blocked: when the item holds more than one file, Taxila opens the
              oldest, so students wouldn’t see this handout. In Taxila, open {ITEM} → Edit settings,
              delete the file{c.others.length === 1 ? '' : 's'} named above, keep only {FILE}, save,
              then check again.
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
              onClick={publish}
              disabled={pending}
              data-testid="taxila-publish"
            >
              {pending ? 'Publishing…' : 'Publish to Taxila'}
            </Button>
          )}
        </div>
      )}

      {c && !choosing && (
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setChoosing(true)}
          data-testid="taxila-choose-open"
        >
          Choose a different Taxila course
        </button>
      )}
      {choosing && (
        <TaxilaCourseChooser
          pending={pending}
          onChoose={(id, query) => check(id, query)}
          onCancel={() => setChoosing(false)}
        />
      )}

      {outcome && (
        <div
          className={outcome.status === 'published' ? box.ok : box.bad}
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

/**
 * v1.4.1: search Taxila by name (e.g. "CIL_Exp") and pick the course — for unusual names and test
 * courses. The pick is remembered for this course + semester; the same Course Handout rules apply.
 */
function TaxilaCourseChooser({
  pending,
  onChoose,
  onCancel,
}: {
  pending: boolean;
  onChoose: (courseId: number, query: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<{ id: number; fullname: string }[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  const search = () => {
    setError(null);
    setPicked(null);
    const fd = new FormData();
    fd.set('query', query.trim());
    startSearch(async () => {
      const r = await searchTaxilaCoursesAction(fd);
      if ('error' in r) {
        setResults(null);
        setError(r.error ?? 'Search failed.');
      } else {
        setResults(r.courses);
        setSearched(query.trim());
      }
    });
  };

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="taxila-chooser">
      <p className="text-xs">
        Search Taxila by the course&apos;s name. The course you pick is remembered for this course
        and semester — Check in Taxila and bulk runs use it.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
          placeholder="e.g. CIL_Exp"
          className="bg-background h-9 w-64 rounded-md border px-2"
          aria-label="Taxila course name"
          data-testid="taxila-search-text"
        />
        <Button
          type="button"
          variant="outline"
          onClick={search}
          disabled={searching || query.trim().length < 3}
          data-testid="taxila-search"
        >
          {searching ? 'Searching…' : 'Search Taxila'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      {results && results.length === 0 && (
        <p className="text-xs" data-testid="taxila-search-none">
          No Taxila course has “{searched}” in its name.
        </p>
      )}
      {results && results.length > 0 && (
        <fieldset className="space-y-1" data-testid="taxila-search-results">
          <legend className="text-xs">
            {results.length === 50 ? 'First 50 results' : `${results.length} found`} — pick one:
          </legend>
          {results.map((x) => (
            <label key={x.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="taxila-search-pick"
                checked={picked === x.id}
                onChange={() => setPicked(x.id)}
              />
              {x.fullname} <span className="text-muted-foreground text-xs">(id {x.id})</span>
            </label>
          ))}
          <Button
            type="button"
            className="mt-1"
            onClick={() => picked && onChoose(picked, searched)}
            disabled={!picked || pending}
            data-testid="taxila-search-use"
          >
            {pending ? 'Checking…' : 'Use this course'}
          </Button>
        </fieldset>
      )}
    </div>
  );
}
