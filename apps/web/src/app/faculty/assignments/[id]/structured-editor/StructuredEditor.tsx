'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { Button } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import { saveStructuredDraftAction, submitStructuredForReviewAction } from '../structured-actions';
import { CodedListSection } from './sections/CodedListSection';
import { PartBSessions } from './sections/PartBSessions';
import { Experiential } from './sections/Experiential';
import { EvaluationScheme } from './sections/EvaluationScheme';
import { ImportantLinks } from './sections/ImportantLinks';
import { RichTextSubEditor } from './RichTextSubEditor';
import { PreviewOverlay } from './PreviewOverlay';
import { StructuredAiDraftDialog } from './StructuredAiDraftDialog';
import { AutoFetchBanner } from './AutoFetchBanner';
import { EditorToolbar } from './EditorToolbar';
import { DocumentPage } from './document/DocumentPage';
import { HeaderBlock } from './document/HeaderBlock';
import { CourseDetailsBlock } from './document/CourseDetailsBlock';

interface Props {
  requestId: string;
  initialData: BitsHandoutV1;
  isRework: boolean;
  /**
   * Auto-fetch source info from the URL search params (`?autoFetched=…`).
   * Set on the immediate post-`startEditingAction` redirect (Prompt 11e);
   * cleared when faculty dismisses the banner or resets to empty.
   */
  autoFetch?: {
    tier: 'prior-version' | 'import' | 'empty';
    detail: string;
  };
}

/**
 * Structured handout editor. One `BitsHandoutV1` state; the page is drawn as
 * the handout itself (handout-editor-ux D1/D2) and edited in place, with a
 * separate full-screen Preview rendered by the unchanged `renderBitsHandout()`
 * (D6). On Save / Submit the full state is JSON-serialized and Zod-parsed
 * server-side — the actions, schema and workflow are unchanged.
 *
 * Step 1 of the redesign converts the letterhead and the course-details table;
 * the sections after it keep their existing forms until step 2.
 *
 * No auto-save; beforeunload warning when dirty.
 */
export function StructuredEditor({ requestId, initialData, isRework, autoFetch }: Props) {
  const [data, setData] = useState<BitsHandoutV1>(initialData);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAtLabel, setSavedAtLabel] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const snapshotRef = useRef(JSON.stringify(initialData));
  const isDirty = JSON.stringify(data) !== snapshotRef.current;
  // EvaluationScheme reports its UI-only validity (sub-component weights sum to
  // 100) — a BITS convention enforced at the editor layer, not by the schema.
  const [evalValid, setEvalValid] = useState(true);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
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
        const t = new Date(r.savedAt).toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
        });
        setSavedAtLabel(`Saved draft v${r.versionNo} at ${t}`);
        setNotes('');
      }
    });

  const submit = () =>
    persistViaFD(
      submitStructuredForReviewAction,
      () => setSubmitted(true),
      isRework ? 'Resubmitted after rework.' : 'Submitted for review.',
    );

  const saveBlockedReason = !evalValid
    ? 'Evaluation weights must add up to 100% before you can save.'
    : null;
  const noCo = data.partA.courseObjectives.length === 0;
  const noLo = data.partA.learningOutcomes.length === 0;
  const submitBlockedReason =
    saveBlockedReason ??
    (noCo && noLo
      ? 'Add at least one course objective and one learning outcome before submitting.'
      : noCo
        ? 'Add at least one course objective before submitting.'
        : noLo
          ? 'Add at least one learning outcome before submitting.'
          : null);

  if (submitted) {
    return (
      <p className="text-sm text-emerald-600">
        Submitted. Your Subject Matter Expert will review it first.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="bits-structured-editor">
      {autoFetch && (
        <AutoFetchBanner requestId={requestId} tier={autoFetch.tier} detail={autoFetch.detail} />
      )}

      <EditorToolbar
        isDirty={isDirty}
        pending={pending}
        savedAtLabel={savedAtLabel}
        isRework={isRework}
        saveBlockedReason={saveBlockedReason}
        submitBlockedReason={submitBlockedReason}
        notes={notes}
        onNotesChange={setNotes}
        onSave={save}
        onPreview={() => setPreviewOpen(true)}
        onSubmit={submit}
        onOpenAiDraft={() => setAiDialogOpen(true)}
      />

      {error && (
        <div
          role="alert"
          className="border-destructive bg-destructive/10 text-destructive rounded-md border p-2 text-sm"
          data-testid="bits-editor-error"
        >
          <strong>Could not save:</strong> {error}
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        Click any text on the page to change it. Use <strong>Preview</strong> to see exactly what
        gets published.
      </p>

      <DocumentPage>
        <HeaderBlock
          value={data.metadata}
          onChange={(metadata) => setData({ ...data, metadata })}
        />
        <CourseDetailsBlock
          value={data.partA}
          semester={data.metadata.semester}
          onChange={(partA) => setData({ ...data, partA })}
        />
        <div className="hed-section-divider">
          The sections below move onto the page in the next step
        </div>
      </DocumentPage>

      <div className="space-y-6">
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
                  setData({ ...data, partA: { ...data.partA, laboratoryComponent: undefined } })
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
              setData({ ...data, partA: { ...data.partA, laboratoryComponent: '<p></p>' } })
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
          onChange={(los) => setData({ ...data, partA: { ...data.partA, learningOutcomes: los } })}
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

      {previewOpen && (
        <PreviewOverlay
          requestId={requestId}
          data={data}
          isDirty={isDirty}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      <StructuredAiDraftDialog
        requestId={requestId}
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        onLoadIntoEditor={(next) => setData(next)}
      />
    </div>
  );
}
