import Link from 'next/link';
import { loadDepartmentChecks } from '@/lib/department-checks';
import type { PeopleBase } from '@/lib/people-access';

/** Admin and IC overviews: what is still missing for departments (v1.4.0, plan F14). */
export async function DepartmentChecksPanel({ base = '/admin' }: { base?: PeopleBase }) {
  const c = await loadDepartmentChecks();
  const items: { key: string; text: string; href: string; action: string }[] = [];
  if (c.peopleWithoutDepartment)
    items.push({
      key: 'people',
      text:
        `${c.peopleWithoutDepartment} ${c.peopleWithoutDepartment === 1 ? 'person' : 'people'} with a HOG, PC, faculty or SME role have no department` +
        (c.peopleWithSuggestion
          ? ` (${c.peopleWithSuggestion} with a suggestion ready to accept)`
          : ''),
      href: `${base}/people?department=none`,
      action: 'People',
    });
  if (c.dibbaCodesWithoutDepartment)
    items.push({
      key: 'dibba',
      text: `${c.dibbaCodesWithoutDepartment} of ${c.dibbaCodes} Course Dibba programmes (${c.coursesWithoutDepartment} courses) have no department — people's suggestions and the kick-off's HOG come from these`,
      href: `${base}/departments`,
      action: 'Departments',
    });
  if (c.dibbaCodesNotLinked)
    items.push({
      key: 'dibba-unlinked',
      text: `${c.dibbaCodesNotLinked} Course Dibba programme code${c.dibbaCodesNotLinked === 1 ? ' is' : 's are'} not linked to an HMP programme (${c.coursesNotLinked} courses) — the semester kick-off can't start ${c.dibbaCodesNotLinked === 1 ? 'its' : 'their'} courses`,
      href: base === '/admin' ? '/admin/dibba-codes' : '/ic/kick-off',
      action: base === '/admin' ? 'Dibba codes' : 'Kick-off (Admin links the codes)',
    });
  if (c.awayWithoutBackup.length)
    items.push({
      key: 'away',
      text: `Away with nobody looking after their requests: ${c.awayWithoutBackup.map((p) => p.name).join(', ')}`,
      href: `${base}/people/${c.awayWithoutBackup[0]!.id}`,
      action: 'Set a back-up',
    });
  if (c.programmesWithoutDepartment)
    items.push({
      key: 'programmes',
      text: `${c.programmesWithoutDepartment} HMP programme${c.programmesWithoutDepartment === 1 ? ' has' : 's have'} no department`,
      href: `${base}/departments`,
      action: 'Departments',
    });
  if (c.hogPcWithoutDepartment)
    items.push({
      key: 'hogpc',
      text: `${c.hogPcWithoutDepartment} HOG / PC ${c.hogPcWithoutDepartment === 1 ? 'person has' : 'people have'} no department — they see every department's handouts until one is set`,
      href: `${base}/people?department=none`,
      action: 'People',
    });
  if (c.requestsWithoutDepartment)
    items.push({
      key: 'requests',
      text: `${c.requestsWithoutDepartment} open request${c.requestsWithoutDepartment === 1 ? ' is' : 's are'} in a programme with no department — every HOG and PC sees ${c.requestsWithoutDepartment === 1 ? 'it' : 'them'}`,
      href: `${base}/departments#programmes`,
      action: 'Departments',
    });
  if (c.badEmails)
    items.push({
      key: 'emails',
      text: `${c.badEmails} account${c.badEmails === 1 ? ' has' : 's have'} an email that isn't a single address (BITS sign-in can't match it)`,
      href: `${base}/people?q=%2C`,
      action: 'People',
    });
  if (c.departmentsWithoutHog.length)
    items.push({
      key: 'hog',
      text: `No Head of Group yet: ${c.departmentsWithoutHog.map((d) => d.name).join(', ')}`,
      href: `${base}/people?role=HOG`,
      action: 'People',
    });

  return (
    <div
      className="glass-panel mb-5 overflow-hidden rounded-[10px]"
      data-testid="department-checks"
    >
      <div className="panel-head">
        <h3>Departments — what&apos;s missing</h3>
      </div>
      <div className="panel-body text-sm">
        {items.length === 0 ? (
          <p className="text-emerald-800">
            Every department has a HOG, and every programme and person has a department.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <li
                key={i.key}
                className="flex flex-wrap items-baseline justify-between gap-2"
                data-testid={`check-${i.key}`}
              >
                <span className="text-amber-900">{i.text}</span>
                <Link href={i.href} className="underline">
                  {i.action} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
