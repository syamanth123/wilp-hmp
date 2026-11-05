import Link from 'next/link';
import { loadDepartmentChecks } from '@/lib/department-checks';

/** Admin overview: what is still missing for departments (v1.4.0, plan F14). */
export async function DepartmentChecksPanel() {
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
      href: '/admin/people?department=none',
      action: 'People',
    });
  if (c.dibbaCodesWithoutDepartment)
    items.push({
      key: 'dibba',
      text: `${c.dibbaCodesWithoutDepartment} of ${c.dibbaCodes} Course Dibba programmes have no department — people's suggestions come from these`,
      href: '/admin/departments',
      action: 'Departments',
    });
  if (c.programmesWithoutDepartment)
    items.push({
      key: 'programmes',
      text: `${c.programmesWithoutDepartment} HMP programme${c.programmesWithoutDepartment === 1 ? ' has' : 's have'} no department`,
      href: '/admin/departments',
      action: 'Departments',
    });
  if (c.departmentsWithoutHog.length)
    items.push({
      key: 'hog',
      text: `No Head of Group yet: ${c.departmentsWithoutHog.map((d) => d.name).join(', ')}`,
      href: '/admin/people?role=HOG',
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
