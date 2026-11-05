import { NextResponse } from 'next/server';
import { getSessionUser } from '@hmp/auth';
import { seesAllWork } from '@/lib/handout-access';
import { fold, loadAllItems, matchesSearch } from '@/lib/handout-library';

export const dynamic = 'force-dynamic';

export interface Suggestions {
  courses: { code: string; title: string }[];
  /** id is set only for roles that have people filters (oversight); others search by name. */
  people: { id: string | null; name: string; role: 'Faculty' | 'Subject expert' }[];
}

/**
 * Search suggestions (after 2 characters): courses and people — only from handouts this user may
 * see, through the same access rule as the list, so a suggestion never reveals a hidden handout.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ courses: [], people: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 100);
  if (fold(q).length < 2) return NextResponse.json({ courses: [], people: [] });

  const byTab = await loadAllItems(user);
  const items = [...byTab.published, ...byTab['in-progress'], ...byTab.past].filter(
    (it) => it.kind !== 'not-started',
  );
  const query = fold(q);

  const courses = new Map<string, string>();
  for (const it of items) {
    if (courses.size >= 8) break;
    if (!courses.has(it.courseCode) && matchesSearch({ ...it, faculty: [], sme: null }, q))
      courses.set(it.courseCode, it.courseTitle);
  }

  const oversight = seesAllWork(user);
  const people = new Map<string, Suggestions['people'][number]>();
  for (const it of items) {
    const found: Suggestions['people'] = [
      ...it.faculty.map((name, i) => ({
        id: oversight ? (it.facultyIds[i] ?? null) : null,
        name,
        role: 'Faculty' as const,
      })),
      ...(it.sme
        ? [{ id: oversight ? it.smeId : null, name: it.sme, role: 'Subject expert' as const }]
        : []),
    ];
    for (const p of found) {
      if (people.size >= 6) break;
      const key = `${p.role}|${p.id ?? p.name}`;
      if (!people.has(key) && fold(p.name).includes(query)) people.set(key, p);
    }
  }

  const body: Suggestions = {
    courses: [...courses].map(([code, title]) => ({ code, title })),
    people: [...people.values()],
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
