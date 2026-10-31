'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import type { BitsHandoutV1 } from '@hmp/db';
import { saveStructuredDraftAction, submitStructuredForReviewAction } from '../structured-actions';
import { PreviewOverlay } from './PreviewOverlay';
import { StructuredAiDraftDialog } from './StructuredAiDraftDialog';
import { AutoFetchBanner } from './AutoFetchBanner';
import { EditorToolbar } from './EditorToolbar';
import { DocumentPage } from './document/DocumentPage';
import { HeaderBlock } from './document/HeaderBlock';
import { CourseDetailsBlock } from './document/CourseDetailsBlock';
import {
  CodedTable,
  CourseDescriptionBody,
  CoursePlanTable,
  EvaluationBody,
  ExperientialBody,
  ImportantNotesBody,
  SectionHeading,
} from './document/Sections';
import { RichTextSubEditor } from './RichTextSubEditor';
import { isEvaluationValid } from './sections/evaluation-validity';

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
  /** AI_FEATURES_ENABLED, read on the server. Off: no AI draft anywhere. */
  aiEnabled?: boolean;
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The first reason this handout cannot be saved yet, in plain words, or null.
 * Mirrors what the schema would reject on the server, so faculty see the
 * problem before pressing Save instead of after (handout-editor-ux D4).
 */
export function saveBlocker(d: BitsHandoutV1): string | null {
  const a = d.partA;
  if (a.courseNumbers.length === 0) return 'Add the course number before saving.';
  if (a.courseTitle.trim() === '') return 'Add the course title before saving.';
  if (a.instructors.length === 0) return 'Add at least one instructor before saving.';
  if (a.textBooks.length === 0) return 'Add at least one text book before saving.';
  if (d.partB.sessions.some((s) => s.sessionNumber.trim() === ''))
    return 'Every row of the course plan needs a session number.';
  if (!looksLikeUrl(d.importantLinks.elearnPortalUrl))
    return 'The eLearn portal address must start with https:// before saving.';
  if (!isEvaluationValid(d.evaluation))
    return 'Evaluation weights must add up to 100% before you can save.';
  return null;
}

/** The first reason it cannot be submitted (on top of saveBlocker), or null. */
export function submitBlocker(d: BitsHandoutV1): string | null {
  const save = saveBlocker(d);
  if (save) return save;
  const noCo = d.partA.courseObjectives.length === 0;
  const noLo = d.partA.learningOutcomes.length === 0;
  if (noCo && noLo)
    return 'Add at least one course objective and one learning outcome before submitting.';
  if (noCo) return 'Add at least one course objective before submitting.';
  if (noLo) return 'Add at least one learning outcome before submitting.';
  return null;
}

/**
 * Structured handout editor (handout-editor-ux). The page IS the handout: the
 * published stylesheet, the same sections in the same order as
 * `renderBitsHandout()`, every value edited in place. Preview opens the
 * unchanged renderer full-screen. Save / Submit post the whole `BitsHandoutV1`
 * to the unchanged server actions (Zod-validated there).
 *
 * No auto-save; beforeunload warning when dirty.
 */
export function StructuredEditor({
  requestId,
  initialData,
  isRework,
  autoFetch,
  aiEnabled = false,
}: Props) {
  const [data, setData] = useState<BitsHandoutV1>(initialData);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAtLabel, setSavedAtLabel] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const snapshotRef = useRef(JSON.stringify(initialData));
  const isDirty = JSON.stringify(data) !== snapshotRef.current;
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

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

  if (submitted) {
    return (
      <p className="text-sm text-emerald-600">
        Submitted. Your Subject Matter Expert will review it first.
      </p>
    );
  }

  const partA = data.partA;
  const setPartA = (next: typeof partA) => setData({ ...data, partA: next });
  const m = data.metadata;
  const footerSegs = [
    m.formNumber ? `Form ${m.formNumber}` : null,
    m.documentTitle,
    m.semester,
    partA.versionNo != null ? `Version ${partA.versionNo}` : null,
    partA.date || null,
  ].filter(Boolean);

  let n = 0;
  const next = () => (n += 1);

  return (
    <div className="space-y-3" data-testid="bits-structured-editor">
      {autoFetch && (
        <AutoFetchBanner requestId={requestId} tier={autoFetch.tier} detail={autoFetch.detail} />
      )}

      <EditorToolbar
        isDirty={isDirty}
        pending={pending}
        savedAtLabel={savedAtLabel}
        isRework={isRework}
        saveBlockedReason={saveBlocker(data)}
        submitBlockedReason={submitBlocker(data)}
        notes={notes}
        onNotesChange={setNotes}
        onSave={save}
        onPreview={() => setPreviewOpen(true)}
        onSubmit={submit}
        onOpenAiDraft={aiEnabled ? () => setAiDialogOpen(true) : undefined}
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
        <HeaderBlock value={m} onChange={(metadata) => setData({ ...data, metadata })} />
        <CourseDetailsBlock value={partA} semester={m.semester} onChange={setPartA} />

        <SectionHeading n={next()} title="Course Description" />
        <CourseDescriptionBody value={partA} onChange={setPartA} />

        <SectionHeading n={next()} title="Scope and Objectives" />
        <CodedTable
          rows={partA.courseObjectives}
          onChange={(rows) => setPartA({ ...partA, courseObjectives: rows })}
          prefix="CO"
          codeHeader="CO"
          textHeader="Description"
          field="description"
          className="bits-handout-coded"
          placeholder="Click to add course objective"
          addLabel="Add objective"
          emptyText="No objectives yet."
          testPrefix="CO"
          problem={
            partA.courseObjectives.length === 0
              ? 'Add at least one course objective before submitting.'
              : null
          }
        />

        <SectionHeading n={next()} title="Learning Outcomes" />
        <CodedTable
          rows={partA.learningOutcomes}
          onChange={(rows) => setPartA({ ...partA, learningOutcomes: rows })}
          prefix="LO"
          codeHeader="LO"
          textHeader="Description"
          field="description"
          className="bits-handout-coded"
          placeholder="Click to add learning outcome"
          addLabel="Add outcome"
          emptyText="No learning outcomes yet."
          testPrefix="LO"
          problem={
            partA.learningOutcomes.length === 0
              ? 'Add at least one learning outcome before submitting.'
              : null
          }
        />

        <SectionHeading n={next()} title="Text Books" />
        <CodedTable
          rows={partA.textBooks}
          onChange={(rows) => setPartA({ ...partA, textBooks: rows })}
          prefix="T"
          codeHeader="Code"
          textHeader="Citation"
          field="citation"
          className="bits-handout-books"
          placeholder="Click to add a text book: author, title, publisher, year"
          addLabel="Add text book"
          emptyText="No text books yet."
          testPrefix="T"
          minRows={1}
        />

        <SectionHeading n={next()} title="Reference Material" />
        <CodedTable
          rows={partA.referenceBooks}
          onChange={(rows) => setPartA({ ...partA, referenceBooks: rows })}
          prefix="R"
          codeHeader="Code"
          textHeader="Citation"
          field="citation"
          className="bits-handout-books"
          placeholder="Click to add a reference: author, title, publisher, year"
          addLabel="Add reference"
          emptyText="No reference material (optional)."
          testPrefix="R"
        />

        <SectionHeading n={next()} title="Course Plan" />
        <CoursePlanTable
          sessions={data.partB.sessions}
          onChange={(sessions) => setData({ ...data, partB: { sessions } })}
        />

        <SectionHeading n={next()} title="Experiential Learning" />
        <ExperientialBody
          value={data.experientialLearning}
          onChange={(experientialLearning) => setData({ ...data, experientialLearning })}
        />

        <SectionHeading n={next()} title="Evaluation Scheme" />
        <EvaluationBody
          value={data.evaluation}
          onChange={(evaluation) => setData({ ...data, evaluation })}
        />

        <SectionHeading n={next()} title="Important Notes & Links" />
        <ImportantNotesBody
          evaluation={data.evaluation}
          links={data.importantLinks}
          onEvaluation={(evaluation) => setData({ ...data, evaluation })}
          onLinks={(importantLinks) => setData({ ...data, importantLinks })}
        />

        <SectionHeading n={next()} title="Evaluation Guidelines" />
        <RichTextSubEditor
          variant="page"
          minHeightPx={40}
          value={data.evaluationGuidelines}
          onChange={(html) => setData({ ...data, evaluationGuidelines: html })}
          placeholder="Click to add evaluation guidelines (optional)."
          label="Evaluation guidelines"
          testId="bits-eval-guidelines"
        />

        <div className="bits-handout-footer">
          <div>
            <strong>BITS Pilani Work Integrated Learning Programmes Division</strong>
          </div>
          <div>{footerSegs.join(' · ')}</div>
        </div>
      </DocumentPage>

      {previewOpen && (
        <PreviewOverlay
          requestId={requestId}
          data={data}
          isDirty={isDirty}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      {aiEnabled && (
        <StructuredAiDraftDialog
          requestId={requestId}
          open={aiDialogOpen}
          onClose={() => setAiDialogOpen(false)}
          onLoadIntoEditor={(nextData) => setData(nextData)}
        />
      )}
    </div>
  );
}
