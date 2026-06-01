'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import {
  generateStructuredAiDraftAction,
  applyStructuredAiDraftAction,
} from '../structured-actions';

interface Props {
  requestId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Called with the parsed BitsHandoutV1 when faculty clicks "Load into editor".
   * Loads as in-memory form state — does NOT persist by itself; faculty saves
   * via the editor's existing Save button. The "Apply as new version" button
   * is a separate path that calls `applyStructuredAiDraftAction` server-side
   * and creates a new HandoutVersion.
   */
  onLoadIntoEditor: (data: BitsHandoutV1) => void;
}

interface DraftState {
  draftId: string;
  data: BitsHandoutV1;
  source: 'ai' | 'cache' | 'stub';
  model: string;
}

/**
 * AI Draft dialog for the structured editor (Prompt 11d-b). Generates a
 * `BitsHandoutV1` (not TipTap JSON like the legacy `AiDraftDialog`) and
 * lets faculty either:
 *   - **Load into editor** — merges the AI draft into the editor's form
 *     state. Faculty reviews + edits without committing a version yet.
 *   - **Apply as new version** — persists via `applyStructuredAiDraftAction`
 *     and reloads the page so the new currentVersion is picked up. Same
 *     UX as the legacy dialog's Insert button.
 *
 * Failure modes surface verbatim:
 *   - Malformed AI output → server-side message ("AI returned malformed JSON…").
 *   - Zod-invalid AI output → server-side message with the first issue path.
 *   - AI provider unconfigured → no error; the stub path returns a generic
 *     starting point with a neutral banner.
 */
export function StructuredAiDraftDialog({ requestId, open, onClose, onLoadIntoEditor }: Props) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const runGenerate = (forceRefresh: boolean) => {
    setError(null);
    setDraft(null);
    setApplied(false);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('forceRefresh', forceRefresh ? 'true' : 'false');
    startTransition(async () => {
      const r = await generateStructuredAiDraftAction(fd);
      if ('error' in r && r.error) {
        setError(r.error);
      } else if (r.ok) {
        setDraft({
          draftId: r.draftId!,
          data: r.data!,
          source: r.source!,
          model: r.model!,
        });
      }
    });
  };

  // Auto-run on first open. Deps intentionally limited to `open` — including
  // draft/pending/error would create an infinite loop (runGenerate sets them).
  useEffect(() => {
    if (open && !draft && !pending && !error) runGenerate(false);
  }, [open]);

  const loadIntoEditor = () => {
    if (!draft) return;
    onLoadIntoEditor(draft.data);
    onClose();
  };

  const applyAsVersion = () => {
    if (!draft) return;
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('draftId', draft.draftId);
    startTransition(async () => {
      const r = await applyStructuredAiDraftAction(fd);
      if ('error' in r && r.error) setError(r.error);
      else {
        setApplied(true);
        setTimeout(() => window.location.reload(), 300);
      }
    });
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI structured handout draft"
      data-testid="bits-ai-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          width: 'min(720px, 100%)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>AI Draft (structured)</h2>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              Generates a starting BitsHandoutV1 from your course context. Review and edit before
              saving — AI output is a starting point, not a finished handout.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 0,
              fontSize: 22,
              lineHeight: 1,
              color: '#6b7280',
              cursor: pending ? 'not-allowed' : 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
          {pending && !draft && (
            <p className="text-muted-foreground text-sm">Drafting your handout…</p>
          )}

          {error && (
            <div
              role="alert"
              data-testid="bits-ai-error"
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              <strong>Generation failed:</strong> {error}
            </div>
          )}

          {draft && (
            <>
              <div
                style={{
                  background: draft.source === 'stub' ? '#fff7ed' : '#f0f9ff',
                  border: `1px solid ${draft.source === 'stub' ? '#fed7aa' : '#bae6fd'}`,
                  color: draft.source === 'stub' ? '#9a3412' : '#075985',
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  marginBottom: 12,
                }}
              >
                {draft.source === 'stub' ? (
                  <span>
                    <strong>Using template stub.</strong> AI is not configured; results are a
                    generic starting point, not customized to your course.
                  </span>
                ) : draft.source === 'cache' ? (
                  <span>
                    <strong>Reused recent AI draft.</strong> Model: <code>{draft.model}</code>.{' '}
                    <button
                      type="button"
                      onClick={() => runGenerate(true)}
                      disabled={pending}
                      style={{
                        background: 'transparent',
                        border: '1px solid currentColor',
                        color: 'inherit',
                        padding: '1px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: pending ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Regenerate
                    </button>
                  </span>
                ) : (
                  <span>
                    <strong>AI-generated.</strong> Model: <code>{draft.model}</code>.{' '}
                    <button
                      type="button"
                      onClick={() => runGenerate(true)}
                      disabled={pending}
                      style={{
                        background: 'transparent',
                        border: '1px solid currentColor',
                        color: 'inherit',
                        padding: '1px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: pending ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Regenerate
                    </button>
                  </span>
                )}
              </div>

              <dl
                className="text-sm"
                style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 10px' }}
              >
                <dt className="text-muted-foreground">Course title</dt>
                <dd>{draft.data.partA.courseTitle}</dd>
                <dt className="text-muted-foreground">Course numbers</dt>
                <dd className="font-mono">{draft.data.partA.courseNumbers.join(' / ')}</dd>
                <dt className="text-muted-foreground">Course Objectives</dt>
                <dd>{draft.data.partA.courseObjectives.length} entries</dd>
                <dt className="text-muted-foreground">Text Books</dt>
                <dd>{draft.data.partA.textBooks.length} entries</dd>
                <dt className="text-muted-foreground">Learning Outcomes</dt>
                <dd>{draft.data.partA.learningOutcomes.length} entries</dd>
                <dt className="text-muted-foreground">Part B sessions</dt>
                <dd>{draft.data.partB.sessions.length} entries</dd>
                <dt className="text-muted-foreground">Evaluation components</dt>
                <dd>{draft.data.evaluation.components.length} EC(s)</dd>
              </dl>
            </>
          )}
        </div>

        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {applied ? (
            <span className="text-sm text-emerald-600">Applied as new version. Reloading…</span>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Discard
              </Button>
              <Button
                variant="outline"
                onClick={loadIntoEditor}
                disabled={pending || !draft}
                data-testid="bits-ai-load"
              >
                Load into editor (review before saving)
              </Button>
              <Button
                onClick={applyAsVersion}
                disabled={pending || !draft}
                data-testid="bits-ai-apply"
              >
                {pending ? 'Applying…' : 'Apply as new version'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
