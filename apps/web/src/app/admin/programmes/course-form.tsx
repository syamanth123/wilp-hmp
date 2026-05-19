'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@hmp/ui';
import { createCourseAction } from './actions';

export function CourseCreateForm() {
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create course</CardTitle>
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
            <Input id="code" name="code" placeholder="SE-ZG600" required />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Advanced Topics" required />
          </div>
          <div>
            <Label htmlFor="credits">Credits</Label>
            <Input id="credits" name="credits" type="number" min={1} max={20} defaultValue={3} required />
          </div>
          <div className="md:col-span-4">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create course'}
            </Button>
            {error ? <span className="ml-3 text-sm text-destructive">{error}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
