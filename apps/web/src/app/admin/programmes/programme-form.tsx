'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@hmp/ui';
import { createProgrammeAction } from './actions';

export function ProgrammeCreateForm() {
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create programme</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={(fd) => {
            setError(undefined);
            startTransition(async () => {
              const res = await createProgrammeAction(fd);
              if (res?.error) setError(res.error);
            });
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
        >
          <div>
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" placeholder="MTECH-AI" required />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="M.Tech Artificial Intelligence" required />
          </div>
          <div className="md:col-span-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create programme'}
            </Button>
            {error ? <span className="ml-3 text-sm text-destructive">{error}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
