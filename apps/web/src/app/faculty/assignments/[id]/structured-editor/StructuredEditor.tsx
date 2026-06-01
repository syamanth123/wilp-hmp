'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import { saveStructuredDraftAction, submitStructuredForReviewAction } from '../structured-actions';
import { InstitutionalHeader } from './sections/InstitutionalHeader';
import { PartAMetadata } from './sections/PartAMetadata';
import { CodedListSection } from './sections/CodedListSection';
import { PartBSessions } from './sections/PartBSessions';
import { Experiential } from './sections/Experiential';
import { EvaluationScheme } from './sections/EvaluationScheme';
import { ImportantLinks } from './sections/ImportantLinks';
import { RichTextSubEditor } from './RichTextSubEditor';
import { PreviewPane } from './PreviewPane';
import { StructuredAiDraftDialog } from './StructuredAiDraftDialog';

interface Props {
  requestId: string;
  initialData: BitsHandoutV1;
  isRework: boolean;
}

/**
 * Prompt 11d structured editor. Single `BitsHandoutV1`-shaped state; each
 * section is a controlled component receiving its slice + onChange. Editor
 * and Preview tabs share the same state — Preview renders via the SAME
 * `renderBitsHandout()` the LMS export uses ("what you see is what gets
 * published"). On Save / Submit, the full state is JSON-serialized and
 * Zod-parsed server-side; on failure the first error path + message is
 * surfaced in a sticky banner.
 *
 * No auto-save (matches the legacy TipTap editor). beforeunload warning
 * when dirty.
 */
export function StructuredEditor({ requestId, initialData, isRework }: Props) {
  const [data, setData] = useState<BitsHandoutV1>(initialData);
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const snapshotRef = useRef(JSON.stringify(initialData));
  const isDirty = JSON.stringify(data) !== snapshotRef.current;
  // Prompt 11d-b: EvaluationScheme reports its UI-only validity (sub-component
  // weights sum to 100). Save/Submit are disabled until valid. The schema
  // (Zod) doesn't enforce sum-to-100; this is a BITS convention enforced at
  // the editor layer — see docs/dev-handoff-audit.md §1.
  const [evalValid, setEvalValid] = useState(true);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  // Codes from Part A that PartBSessions exposes to the references chip-list
  // as typeahead suggestions.
  const availableReferences = [
    ...data.partA.textBooks.map((b) => b.code),
    ...data.partA.referenceBooks.map((b) => b.code),
  ];

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const persistViaFD = (
    action: typeof saveStructuredDraftAction | typeof submitStructuredForReviewAction,
    onOk: (r: { versionNo?: number; savedAt?: string }) => void,
    submitNote?: string,
  ) => {
    setError(null);
    setSavedAt(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('data', JSON.stringify(data));
    fd.set('notes', notes || submitNote || '');
    const snapshot = JSON.stringify(data);
    startTransition(async () => {
      const r = await action(fd);
      if ('error' in r && r.error) {
        setError(r.error);
        return;
      }
      snapshotRef.current = snapshot;
      onOk(r as { versionNo?: number; savedAt?: string });
    });
  };

  const save = () =>
    persistViaFD(saveStructuredDraftAction, (r) => {
      if (r.versionNo != null && r.savedAt) {
        setSavedAt(`Saved v${r.versionNo} at ${new Date(r.savedAt).toLocaleTimeString()}`);
        setNotes('');
      }
    });

  const submit = () =>
    persistViaFD(
      submitStructuredForReviewAction,
      () => setSubmitted(true),
      isRework ? 'Resubmitted after rework.' : 'Submitted for review.',
    );

  if (submitted) {
    return (
      <p className="text-sm text-emerald-600">Submitted. The PC will now review your handout.</p>
    );
  }

  return (
    <div className="space-y-4" data-testid="bits-structured-editor">
      <div className="flex items-center gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab('editor')}
          className={`border-b-2 px-3 py-1.5 text-sm font-medium ${
            tab === 'editor'
              ? 'border-bits-navy text-foreground'
              : 'text-muted-foreground border-transparent'
          }`}
          data-testid="bits-tab-editor"
        >
          Editor
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`border-b-2 px-3 py-1.5 text-sm font-medium ${
            tab === 'preview'
              ? 'border-bits-navy text-foreground'
              : 'text-muted-foreground border-transparent'
          }`}
          data-testid="bits-tab-preview"
        >
          Preview
        </button>
        <div className="ml-auto flex items-center gap-2">
          {isDirty && (
            <span
              className="badge-gold"
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 600,
              }}
              aria-live="polite"
            >
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            onClick={() => setAiDialogOpen(true)}
            title="Generate a starting handout from course title and context."
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-slate-50"
            data-testid="bits-ai-open"
          >
            AI Draft
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive bg-destructive/10 text-destructive sticky top-0 z-10 rounded-md border p-2 text-sm"
          data-testid="bits-editor-error"
        >
          <strong>Save failed:</strong> {error}
        </div>
      )}
      {savedAt && (
        <p className="text-sm text-emerald-600" data-testid="bits-editor-saved">
          {savedAt}
        </p>
      )}

      {tab === 'editor' ? (
        <div className="space-y-6">
          <InstitutionalHeader
            value={data.metadata}
            onChange={(metadata) => setData({ ...data, metadata })}
          />
          <PartAMetadata value={data.partA} onChange={(partA) => setData({ ...data, partA })} />
          <section aria-label="Course Description" className="space-y-1">
            <h3 className="text-base font-semibold">Course Description</h3>
            <RichTextSubEditor
              value={data.partA.courseDescription}
              onChange={(html) =>
                setData({ ...data, partA: { ...data.partA, courseDescription: html } })
              }
            />
          </section>
          {data.partA.laboratoryComponent !== undefined ? (
            <section aria-label="Laboratory Component" className="space-y-1">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Laboratory Component</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setData({
                      ...data,
                      partA: { ...data.partA, laboratoryComponent: undefined },
                    })
                  }
                >
                  Remove
                </Button>
              </div>
              <RichTextSubEditor
                value={data.partA.laboratoryComponent}
                onChange={(html) =>
                  setData({ ...data, partA: { ...data.partA, laboratoryComponent: html } })
                }
              />
            </section>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setData({
                  ...data,
                  partA: { ...data.partA, laboratoryComponent: '<p></p>' },
                })
              }
            >
              + Add Laboratory Component
            </Button>
          )}
          <CodedListSection
            title="Course Objectives"
            codePrefix="CO"
            rightLabel="Description"
            rightFieldKey="description"
            codeRegex={/^CO\d+$/}
            value={data.partA.courseObjectives}
            onChange={(objs) =>
              setData({ ...data, partA: { ...data.partA, courseObjectives: objs } })
            }
            makeNew={(code) => ({ code, description: '' })}
          />
          <CodedListSection
            title="Text Books"
            codePrefix="T"
            rightLabel="Citation"
            rightFieldKey="citation"
            codeRegex={/^T\d+$/}
            value={data.partA.textBooks}
            onChange={(books) => setData({ ...data, partA: { ...data.partA, textBooks: books } })}
            makeNew={(code) => ({ code, citation: '' })}
          />
          <CodedListSection
            title="Reference Books"
            codePrefix="R"
            rightLabel="Citation"
            rightFieldKey="citation"
            codeRegex={/^R\d+$/}
            allowEmpty
            value={data.partA.referenceBooks}
            onChange={(books) =>
              setData({ ...data, partA: { ...data.partA, referenceBooks: books } })
            }
            makeNew={(code) => ({ code, citation: '' })}
          />
          <CodedListSection
            title="Learning Outcomes"
            codePrefix="LO"
            rightLabel="Description"
            rightFieldKey="description"
            codeRegex={/^LO\d+$/}
            value={data.partA.learningOutcomes}
            onChange={(los) =>
              setData({ ...data, partA: { ...data.partA, learningOutcomes: los } })
            }
            makeNew={(code) => ({ code, description: '' })}
          />
          <PartBSessions
            value={data.partB.sessions}
            onChange={(sessions) => setData({ ...data, partB: { sessions } })}
            availableReferences={availableReferences}
          />
          <Experiential
            value={data.experientialLearning}
            onChange={(experientialLearning) => setData({ ...data, experientialLearning })}
          />
          <EvaluationScheme
            value={data.evaluation}
            onChange={(evaluation) => setData({ ...data, evaluation })}
            onValidityChange={setEvalValid}
          />
          <ImportantLinks
            value={data.importantLinks}
            onChange={(importantLinks) => setData({ ...data, importantLinks })}
          />
          <section aria-label="Evaluation Guidelines" className="space-y-1">
            <h3 className="text-base font-semibold">Evaluation Guidelines</h3>
            <RichTextSubEditor
              value={data.evaluationGuidelines}
              onChange={(html) => setData({ ...data, evaluationGuidelines: html })}
            />
          </section>
        </div>
      ) : (
        <PreviewPane data={data} />
      )}

      <div className="bg-background sticky bottom-0 -mx-4 flex flex-wrap items-end gap-2 border-t px-4 py-2">
        <div className="grid grow gap-1">
          <Label htmlFor="bits-version-notes">Version notes (optional)</Label>
          <textarea
            id="bits-version-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed in this version?"
            rows={1}
            className="bg-background rounded-md border p-2 text-sm"
          />
        </div>
        <Button
          variant="outline"
          onClick={save}
          // Disable rule has TWO parts (Prompt 11d-b): not pending AND the
          // evaluation section's UI-only sum-to-100 rule satisfied. The
          // second part is a BITS convention enforced at this layer; the
          // schema accepts any 0-100 weight per sub-component.
          disabled={pending || !evalValid}
          data-testid="bits-save-button"
        >
          {pending ? 'Saving…' : 'Save version'}
        </Button>
        <Button onClick={submit} disabled={pending || !evalValid} data-testid="bits-submit-button">
          {pending ? 'Submitting…' : isRework ? 'Resubmit for review' : 'Submit for review'}
        </Button>
      </div>
      <StructuredAiDraftDialog
        requestId={requestId}
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        onLoadIntoEditor={(next) => setData(next)}
      />
    </div>
  );
}
