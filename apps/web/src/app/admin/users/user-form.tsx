'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@hmp/ui';
import { createUserAction } from './actions';

export function UserCreateForm({ roles }: { roles: string[] }) {
  const [error, setError] = useState<string | undefined>();
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create user</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) => {
            setError(undefined);
            setOk(false);
            startTransition(async () => {
              const res = await createUserAction(formData);
              if (res?.error) setError(res.error);
              else setOk(true);
            });
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-5"
        >
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" minLength={6} required defaultValue="password" />
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              name="role"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              required
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="facultyType">Faculty Type</Label>
            <select
              id="facultyType"
              name="facultyType"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">—</option>
              <option value="ON_CAMPUS">On-Campus</option>
              <option value="OFF_CAMPUS">Off-Campus</option>
              <option value="ADJUNCT">Adjunct</option>
              <option value="GUEST">Guest</option>
            </select>
          </div>
          <div className="md:col-span-5">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create user'}
            </Button>
            {error ? <span className="ml-3 text-sm text-destructive">{error}</span> : null}
            {ok ? <span className="ml-3 text-sm text-emerald-600">User created</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
