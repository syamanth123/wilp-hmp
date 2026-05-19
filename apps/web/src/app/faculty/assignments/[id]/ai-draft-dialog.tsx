'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { generateAiDraftAction, applyAiDraftAction } from './ai-actions';

interface Props {
  requestId: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful Insert so the parent can refresh. */
  onApplied?: () => void;
}

interface DraftState {
  draftId: string;
  previewHtml: string;
  source: 'ai' | 'cache' | 'stub';
  model: string;
}

export function AiDraftDialog({ requestId, open, onClose, onApplied }: Props) {
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
      const r = await generateAiDraftAction(fd);
      if (r?.error) setError(r.error);
      else if (r?.ok) {
        setDraft({
          draftId: r.draftId!,
          previewHtml: r.previewHtml ?? '',
          source: r.source!,
          model: r.model!,
        });
      }
    });
  };

  // Auto-run on first open.
  useEffect(() => {
    if (open && !draft && !pending && !error) {
      runGenerate(false);
    }
  }, [open, draft, pending, error]);

  const insert = () => {
    if (!draft) return;
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('draftId', draft.draftId);
    startTransition(async () => {
      const r = await applyAiDraftAction(fd);
      if (r?.error) setError(r.error);
      else {
        setApplied(true);
        onApplied?.();
        // Soft-reload so the editor picks up the new currentVersion.
        setTimeout(() => {
          window.location.reload();
        }, 300);
      }
    });
  };

  if (!open) return null;

  const sourceLabel =
    draft?.source === 'stub'
      ? 'Template stub (AI provider not configured)'
      : draft?.source === 'cache'
        ? 'Reused recent draft'
        : 'AI-generated';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI handout draft preview"
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
          width: 'min(900px, 100%)',
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
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>AI handout draft</h2>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              Preview a full Part A / Part B / Evaluative draft. Insert replaces your current
              version with a new one.
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
            <p className="text-sm text-muted-foreground">Drafting your handout…</p>
          )}

          {error && (
            <div
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
              {error}
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>
                  <strong>{sourceLabel}</strong> · model: <code>{draft.model}</code>
                </span>
                <button
                  type="button"
                  onClick={() => runGenerate(true)}
                  disabled={pending}
                  style={{
                    background: 'transparent',
                    border: '1px solid currentColor',
                    color: 'inherit',
                    padding: '2px 10px',
                    borderRadius: 999,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: pending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {pending ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>

              <article
                className="prose prose-sm max-w-none rounded-md border bg-background p-4"
                dangerouslySetInnerHTML={{ __html: draft.previewHtml }}
              />
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
          }}
        >
          {applied ? (
            <span className="text-sm text-emerald-600">Inserted as new version. Reloading…</span>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Discard
              </Button>
              <Button onClick={insert} disabled={pending || !draft}>
                {pending ? 'Inserting…' : 'Insert into editor'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
