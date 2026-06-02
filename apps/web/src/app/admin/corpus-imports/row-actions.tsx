'use client';

import { useTransition } from 'react';
import { Button } from '@hmp/ui';
import { reParseImportAction, deleteImportAction } from './actions';

interface Props {
  id: string;
}

export function RowActions({ id }: Props) {
  const [pending, startTransition] = useTransition();

  const reparse = () => {
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const r = await reParseImportAction(fd);
      if ('error' in r && r.error) console.error('reparse_failed', r.error);
    });
  };

  const remove = () => {
    if (!window.confirm('Delete this import row? The source file is not touched.')) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const r = await deleteImportAction(fd);
      if ('error' in r && r.error) console.error('delete_failed', r.error);
    });
  };

  return (
    <div className="flex gap-1">
      <Button variant="outline" size="sm" onClick={reparse} disabled={pending}>
        Re-parse
      </Button>
      <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
        Delete
      </Button>
    </div>
  );
}
