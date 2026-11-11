import { prisma, RoleName } from '@hmp/db';

/**
 * v1.4.2 (F10, H22) — the people on a request, who can be @mentioned in its comments: its current HOG and PC,
 * active faculty, the SME, and the Instruction Cell. Someone else couldn't open the request, so they can't be
 * mentioned. Worker-safe (no '@/' imports): the comment notice recomputes mentions from the text.
 */
export interface RequestPerson {
  id: string;
  name: string;
  role: 'HOG' | 'PC' | 'Faculty' | 'SME' | 'IC';
}

export async function peopleOnRequest(requestId: string): Promise<RequestPerson[]> {
  const [r, ic] = await Promise.all([
    prisma.handoutRequest.findUnique({
      where: { id: requestId },
      select: {
        assignees: {
          where: { endedAt: null, role: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] } },
          select: { role: true, user: { select: { id: true, name: true, active: true } } },
        },
        assignments: {
          where: { active: true },
          select: { faculty: { select: { id: true, name: true, active: true } } },
        },
        smeAssignment: { select: { smeUser: { select: { id: true, name: true, active: true } } } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, roles: { some: { role: { name: RoleName.INSTRUCTION_CELL } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  if (!r) return [];
  const out = new Map<string, RequestPerson>();
  const add = (u: { id: string; name: string; active?: boolean }, role: RequestPerson['role']) => {
    if (u.active === false || out.has(u.id)) return;
    out.set(u.id, { id: u.id, name: u.name, role });
  };
  for (const a of r.assignees) add(a.user, a.role === RoleName.HOG ? 'HOG' : 'PC');
  for (const a of r.assignments) add(a.faculty, 'Faculty');
  if (r.smeAssignment) add(r.smeAssignment.smeUser, 'SME');
  for (const u of ic) add(u, 'IC');
  return [...out.values()];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Who a comment mentions: "@<their name>" followed by the end, a space or punctuation (so "@Dr A" doesn't
 * match "@Dr AB"). Longest names first, so a name that contains another is matched whole.
 */
export function mentionedIn(body: string, people: RequestPerson[]): RequestPerson[] {
  const found = new Map<string, RequestPerson>();
  let rest = body;
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp(`@${escapeRe(p.name)}(?=$|[\\s.,;:!?)\\]'"])`, 'gi');
    if (re.test(rest)) {
      found.set(p.id, p);
      rest = rest.replace(re, ' ');
    }
  }
  return [...found.values()];
}
