'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Button, Label } from '@hmp/ui';
import { TIPTAP_EXTENSIONS } from '@/lib/tiptap-extensions';
import { saveDraftAction, submitForReviewAction } from './actions';
import { AiDraftDialog } from './ai-draft-dialog';

interface Props {
  requestId: string;
  initialJson: unknown;
  isRework: boolean;
}

export function EditorPanel({ requestId, initialJson, isRework }: Props) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [isDirty, setIsDirty] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const lastSavedSnapshot = useRef<string>(
    JSON.stringify(initialJson ?? { type: 'doc', content: [] }),
  );

  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    content: (initialJson as Record<string, unknown>) ?? {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[280px] rounded-md border bg-background p-4 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const next = JSON.stringify(editor.getJSON());
      setIsDirty(next !== lastSavedSnapshot.current);
    },
  });

  // Warn on tab close / nav while dirty.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const currentJson = () => editor?.getJSON() ?? { type: 'doc', content: [] };

  const save = () => {
    setError(null);
    setSavedAt(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('contentJson', JSON.stringify(currentJson()));
    fd.set('notes', notes);
    const snapshot = JSON.stringify(currentJson());
    startTransition(async () => {
      const r = await saveDraftAction(fd);
      if (r?.error) setError(r.error);
      else if (r?.ok) {
        setSavedAt(`Saved v${r.versionNo} at ${new Date(r.savedAt!).toLocaleTimeString()}`);
        setNotes('');
        lastSavedSnapshot.current = snapshot;
        setIsDirty(false);
      }
    });
  };

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('contentJson', JSON.stringify(currentJson()));
    fd.set('notes', notes || (isRework ? 'Resubmitted after rework.' : 'Submitted for review.'));
    const snapshot = JSON.stringify(currentJson());
    startTransition(async () => {
      const r = await submitForReviewAction(fd);
      if (r?.error) setError(r.error);
      else {
        lastSavedSnapshot.current = snapshot;
        setIsDirty(false);
        setSubmitted(true);
      }
    });
  };

  if (submitted) {
    return (
      <p className="text-sm text-emerald-600">
        Submitted. Your Subject Matter Expert will review it first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <EditorContent editor={editor} />
      <div className="grid gap-2">
        <Label htmlFor="notes">Version notes (optional)</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What changed in this version?"
          className="bg-background min-h-[60px] rounded-md border p-2 text-sm"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {savedAt && <p className="text-sm text-emerald-600">{savedAt}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={save} disabled={pending || !editor}>
          {pending ? 'Saving…' : 'Save version'}
        </Button>
        <Button onClick={submit} disabled={pending || !editor}>
          {pending ? 'Submitting…' : isRework ? 'Resubmit for review' : 'Submit for review'}
        </Button>
        <Button
          variant="outline"
          onClick={() => setAiOpen(true)}
          disabled={pending || !editor}
          aria-label="Generate handout draft with AI"
        >
          Generate with AI
        </Button>
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
      </div>
      <AiDraftDialog requestId={requestId} open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
