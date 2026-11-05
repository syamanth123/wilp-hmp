'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import type { Candidate, PersonInput, SaveResult } from '@/lib/people-save';
import type { WorkRole } from '@/lib/people';
import { savePersonAction } from './actions';

type NeedsReplacements = Extract<SaveResult, { needsReplacements: true }>;

const ROLE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'ADMIN', label: 'Admin', hint: 'everything, including people and settings' },
  { value: 'INSTRUCTION_CELL', label: 'Instruction Cell', hint: 'all departments' },
  { value: 'HOG', label: 'Head of Group', hint: 'one per department' },
  { value: 'PROGRAMME_COMMITTEE', label: 'Programme Committee', hint: '' },
  { value: 'FACULTY', label: 'Faculty', hint: '' },
  { value: 'SME', label: 'Subject expert', hint: '' },
];
const ROLE_WORD: Record<WorkRole, string> = {
  HOG: 'HOG',
  PC: 'PC',
  FACULTY: 'faculty',
  SME: 'subject expert',
};

/**
 * Add / edit a person (v1.4 §B, §B2). If the change would leave open work without an owner, the server
 * answers with that list; the Admin picks who takes each item over (or one person for all), then saves
 * again — the change and the hand-over happen together.
 */
export function PersonForm({
  person,
  departments,
  suggestion,
}: {
  person: Omit<PersonInput, 'replacements'>;
  departments: { id: string; name: string }[];
  /** v1.4.0 (H6): no department yet — what their past courses suggest. */
  suggestion?: { departmentId: string | null; text: string } | null;
}) {
  const router = useRouter();
  const [p, setP] = useState(person);
  const [impact, setImpact] = useState<NeedsReplacements | null>(null);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = 'bg-background h-9 w-full rounded-md border px-2 text-sm';

  const save = (withReplacements: boolean) => {
    setError(null);
    startTransition(async () => {
      const r = await savePersonAction({
        ...p,
        replacements: withReplacements ? replacements : undefined,
      });
      if (r.ok) router.push('/admin/people');
      else if ('needsReplacements' in r) setImpact(r);
      else setError(r.error);
    });
  };
  const toggleRole = (role: string) =>
    setP((x) => ({
      ...x,
      roles: x.roles.includes(role as never)
        ? x.roles.filter((r) => r !== role)
        : [...x.roles, role as never],
    }));
  const forAll = (role: WorkRole, userId: string) =>
    setReplacements((cur) => {
      const next = { ...cur };
      for (const i of impact!.items) if (i.role === role) next[i.key] = userId;
      return next;
    });
  const allChosen = !!impact && impact.items.every((i) => replacements[i.key]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input
            className={field}
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
            data-testid="person-name"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">BITS email</span>
          <input
            className={field}
            value={p.email}
            onChange={(e) => setP({ ...p, email: e.target.value })}
            data-testid="person-email"
          />
          <span className="text-muted-foreground mt-1 block text-xs">
            Must match their BITS email — that is how BITS sign-in finds them.
          </span>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Roles</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ROLE_OPTIONS.map((r) => (
            <label
              key={r.value}
              className="hover:bg-accent flex items-start gap-2 rounded-md border p-2 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={p.roles.includes(r.value as never)}
                onChange={() => toggleRole(r.value)}
                data-testid={`person-role-${r.value}`}
              />
              <span>
                {r.label}
                {r.hint && <span className="text-muted-foreground block text-xs">{r.hint}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Department</span>
          <select
            className={field}
            value={p.departmentId ?? ''}
            onChange={(e) => setP({ ...p, departmentId: e.target.value || null })}
            data-testid="person-department"
          >
            <option value="">None (Instruction Cell / Admin)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {suggestion && !p.departmentId && (
            <span
              className={`mt-1 block text-xs ${suggestion.departmentId ? 'text-emerald-800' : 'text-amber-800'}`}
              data-testid="person-department-suggestion"
            >
              From the courses they taught: {suggestion.text}
              {suggestion.departmentId && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setP({ ...p, departmentId: suggestion.departmentId })}
                    data-testid="person-use-suggestion"
                  >
                    Use it
                  </button>
                </>
              )}
            </span>
          )}
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Faculty type</span>
          <select
            className={field}
            value={p.facultyType ?? ''}
            onChange={(e) => setP({ ...p, facultyType: (e.target.value || null) as never })}
          >
            <option value="">—</option>
            <option value="ON_CAMPUS">On-campus</option>
            <option value="OFF_CAMPUS">Off-campus</option>
            <option value="ADJUNCT">Adjunct</option>
            <option value="GUEST">Guest</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={p.active}
            onChange={(e) => setP({ ...p, active: e.target.checked })}
            data-testid="person-active"
          />
          Active (can sign in)
        </label>
      </div>

      {impact && (
        <section
          role="alertdialog"
          aria-labelledby="impact-title"
          className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          data-testid="person-impact"
        >
          <h2 id="impact-title" className="text-base font-semibold">
            {impact.items.length} open handout{impact.items.length === 1 ? '' : 's'} would be left
            without an owner
          </h2>
          <p>
            Choose who takes each one over. They are moved in the same step as the change, and the
            request history keeps {p.name || 'this person'}’s name.
          </p>
          {(Object.keys(impact.candidates) as WorkRole[]).map((role) => (
            <label key={role} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">All {ROLE_WORD[role]} work to:</span>
              <select
                className="bg-background h-8 rounded-md border px-2"
                defaultValue=""
                onChange={(e) => e.target.value && forAll(role, e.target.value)}
              >
                <option value="">— choose —</option>
                {impact.candidates[role]!.map((c: Candidate) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.department ?? 'all'} · {c.load}
                    {c.sameDepartment ? '' : ' (other dept)'}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1">Handout</th>
                <th className="py-1">As</th>
                <th className="py-1">Goes to</th>
              </tr>
            </thead>
            <tbody>
              {impact.items.map((i) => (
                <tr key={i.key} className="border-t border-amber-200">
                  <td className="py-1.5">
                    <span className="font-mono text-xs">{i.refNo}</span> {i.course}
                    {i.overdue && <span className="ml-1 font-medium text-red-700">overdue</span>}
                  </td>
                  <td className="py-1.5">{ROLE_WORD[i.role]}</td>
                  <td className="py-1.5">
                    <select
                      className="bg-background h-8 rounded-md border px-2"
                      value={replacements[i.key] ?? ''}
                      onChange={(e) =>
                        setReplacements({ ...replacements, [i.key]: e.target.value })
                      }
                      aria-label={`Who takes ${i.refNo} over`}
                    >
                      <option value="">— choose —</option>
                      {impact.candidates[i.role]!.map((c: Candidate) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.load}
                          {c.sameDepartment ? '' : ' (other dept)'}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            onClick={() => save(true)}
            disabled={pending || !allChosen}
            data-testid="person-impact-confirm"
          >
            {pending ? 'Saving…' : 'Hand over and save'}
          </Button>
        </section>
      )}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {!impact && (
        <div className="flex gap-2">
          <Button onClick={() => save(false)} disabled={pending} data-testid="person-save">
            {pending ? 'Checking…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={() => router.push('/admin/people')}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
