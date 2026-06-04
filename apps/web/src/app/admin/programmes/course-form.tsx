'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@hmp/ui';
import { createCourseAction } from './actions';

interface Props {
  /**
   * Optional pre-fill values. Read by the `/admin/programmes` page from URL
   * search params (Prompt 11f-b2 — the corpus-imports admin page links to
   * `/admin/programmes?prefillCode=…&prefillTitle=…` for one-click course
   * creation from an unreconciled import).
   */
  defaultCode?: string;
  defaultTitle?: string;
}

export function CourseCreateForm({ defaultCode, defaultTitle }: Props = {}) {
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {defaultCode ? `Create course — ${defaultCode}` : 'Create course'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={(fd) => {
            setError(undefined);
            startTransition(async () => {
              const res = await createCourseAction(fd);
              if (res?.error) setError(res.error);
            });
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-4"
        >
          <div>
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              placeholder="SE-ZG600"
              defaultValue={defaultCode}
              required
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Advanced Topics"
              defaultValue={defaultTitle}
              required
            />
          </div>
          <div>
            <Label htmlFor="credits">Credits</Label>
            <Input
              id="credits"
              name="credits"
              type="number"
              min={1}
              max={20}
              defaultValue={3}
              required
            />
          </div>
          <div className="md:col-span-4">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create course'}
            </Button>
            {error ? <span className="text-destructive ml-3 text-sm">{error}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
