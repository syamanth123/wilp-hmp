'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@hmp/ui';
import { createUserAction } from './actions';
import { generatePassword } from '@/lib/generate-password';
import { roleLabel } from '@/lib/labels';

export function UserCreateForm({ roles }: { roles: string[] }) {
  const [error, setError] = useState<string | undefined>();
  // Starts empty: never a shared default like "password".
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
              else {
                setOk(true);
                setPassword('');
                setShowPassword(false);
              }
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
            <div className="flex gap-2">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                minLength={6}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="generate-password"
                onClick={() => {
                  setPassword(generatePassword());
                  setShowPassword(true);
                }}
              >
                Generate
              </Button>
            </div>
            {showPassword && password ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Copy this password and send it to the user before you create the account.
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              name="role"
              className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              required
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="facultyType">Faculty type</Label>
            <select
              id="facultyType"
              name="facultyType"
              className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
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
            {error ? <span className="text-destructive ml-3 text-sm">{error}</span> : null}
            {ok ? <span className="ml-3 text-sm text-emerald-600">User created</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
