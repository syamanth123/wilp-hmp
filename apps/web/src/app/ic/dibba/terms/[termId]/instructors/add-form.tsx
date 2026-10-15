'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@hmp/ui';
import { addInstructorAction } from './actions';

/** Add one instructor by course code + email (Phase 4, plan D7). */
export function AddInstructorForm({ termId }: { termId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        setDone(null);
        startTransition(async () => {
          const res = await addInstructorAction(fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          setDone(res.courseCode);
          formRef.current?.reset();
          router.refresh();
        });
      }}
      className="grid grid-cols-1 gap-3 md:grid-cols-6"
      data-testid="dibba-instructor-add-form"
    >
      <input type="hidden" name="termId" value={termId} />
      <div className="md:col-span-2">
        <Label htmlFor="instructor-code">Course code</Label>
        <Input
          id="instructor-code"
          name="courseCode"
          placeholder="CS ZG501"
          required
          maxLength={60}
        />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="instructor-email">Instructor email (an existing HMP account)</Label>
        <Input id="instructor-email" name="email" type="email" required maxLength={254} />
      </div>
      <div className="flex items-end gap-2 pb-2">
        <input id="instructor-lead" name="isLead" type="checkbox" className="h-4 w-4" />
        <Label htmlFor="instructor-lead">Lead instructor</Label>
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-6">
        <Button type="submit" disabled={pending} data-testid="dibba-instructor-add-submit">
          {pending ? 'Adding…' : 'Add instructor'}
        </Button>
        {error && (
          <span
            className="text-destructive text-sm"
            role="alert"
            data-testid="dibba-instructor-add-error"
          >
            {error}
          </span>
        )}
        {done && (
          <span className="text-sm text-emerald-700" data-testid="dibba-instructor-add-done">
            Added to {done}.
          </span>
        )}
      </div>
    </form>
  );
}
