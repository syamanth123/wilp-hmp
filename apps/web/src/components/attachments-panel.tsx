'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { deleteAttachmentAction } from '@/app/(shared)/attachment-actions';
import {
  validateAttachment,
  ALLOWED_ACCEPT_ATTR,
  MAX_SIZE_MB,
  ALLOWED_MIME_TYPES,
} from '@/lib/attachment-validation';
import type { AttachmentView } from '@/lib/attachments';

interface Props {
  requestId: string;
  initial: AttachmentView[];
  /** True when the viewer may add/remove files (assigned faculty + editable status). */
  canUpload: boolean;
  /** The signed-in user's id — delete is offered only on their own uploads. */
  currentUserId: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({ requestId, initial, canUpload, currentUserId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletePending, startDelete] = useTransition();

  const onPick = async (file: File | null) => {
    setError(null);
    if (!file) return;
    const v = validateAttachment({ mimeType: file.type, size: file.size });
    if (!v.ok) {
      setError(v.message ?? 'Invalid file.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch(`/api/handouts/${requestId}/attachments`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(j.message ?? j.error ?? `Upload failed (${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError('Upload failed — check your connection and retry.');
    } finally {
      setUploading(false);
    }
  };

  const onDelete = (attachmentId: string) => {
    setError(null);
    const fd = new FormData();
    fd.set('attachmentId', attachmentId);
    startDelete(async () => {
      const r = await deleteAttachmentAction(fd);
      if ('error' in r) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="space-y-1">
          <input
            type="file"
            accept={ALLOWED_ACCEPT_ATTR}
            disabled={uploading}
            onChange={(e) => {
              void onPick(e.target.files?.[0] ?? null);
              e.target.value = ''; // allow re-selecting the same file after an error
            }}
            className="text-sm"
            data-testid="attachment-file-input"
          />
          <p className="text-muted-foreground text-xs">
            {Object.values(ALLOWED_MIME_TYPES).join(', ')} · up to {MAX_SIZE_MB} MB.
            {uploading ? ' Uploading…' : ''}
          </p>
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm" data-testid="attachment-error">
          {error}
        </p>
      )}

      {initial.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="attachments-empty">
          No attachments yet.
        </p>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="attachments-list">
          {initial.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-2 text-sm">
              <div className="min-w-0">
                <a
                  href={a.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline"
                >
                  {a.filename}
                </a>
                <div className="text-muted-foreground text-xs">
                  {formatBytes(a.size)} · {a.uploaderName} ·{' '}
                  {new Date(a.uploadedAt).toLocaleDateString()}
                </div>
              </div>
              {canUpload && a.uploaderId === currentUserId && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deletePending}
                  onClick={() => onDelete(a.id)}
                  data-testid={`attachment-delete-${a.id}`}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
