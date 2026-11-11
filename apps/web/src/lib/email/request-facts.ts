import { prisma, RoleName, ACTIVE_USER_FILTER } from '@hmp/db';
import { statusLabel } from '../labels';
import {
  DEADLINE_SELECT,
  deadlineInput,
  deadlinesFor,
  formatDueDay,
  loadDeadlineConfig,
  type StageDeadline,
} from '../deadlines';
import { awayByUser, awayText } from '../away';
import { requestTimeline, type TimelineEntry } from '../request-timeline';
import type { EmailPerson, EmailRow } from './layout';

/**
 * v1.4.3 (§G) — everything an email says about one request: the details box, the people box, the recent
 * steps and the due dates. Loaded once per event and shared by every recipient's email.
 */

export interface FactPerson {
  id: string;
  name: string;
  email: string;
  note: string | null;
}

export interface RequestFacts {
  id: string;
  refNo: string;
  status: string;
  statusText: string;
  course: { code: string; title: string };
  semester: { name: string; startDate: Date; examDate: Date | null };
  programme: { code: string; name: string };
  department: string | null;
  version: { no: number; note: string | null; at: Date } | null;
  /** "Slot 3 · Saturday forenoon" from the published Course Dibba, when the course is in it. */
  slot: string | null;
  people: {
    ic: FactPerson | null;
    hog: FactPerson | null;
    pc: FactPerson | null;
    /** Instructor-in-Charge (the Dibba's lead instructor) first. */
    faculty: (FactPerson & { lead: boolean })[];
    sme: FactPerson | null;
  };
  deadlines: StageDeadline[];
  current: StageDeadline | null;
  timeline: TimelineEntry[];
}

const DAY: Record<string, string> = { SAT: 'Saturday', SUN: 'Sunday', FRI: 'Friday' };
const SESSION: Record<string, string> = { FN: 'forenoon', AN: 'afternoon', EV: 'evening' };

export function slotText(
  slots: { slotNo: number; slotDay: string | null; slotSession: string | null }[],
): string | null {
  const taught = slots.filter((s) => s.slotNo > 0);
  if (!taught.length) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of taught) {
    const day = [
      s.slotDay ? (DAY[s.slotDay] ?? s.slotDay) : null,
      s.slotSession ? (SESSION[s.slotSession] ?? s.slotSession) : null,
    ]
      .filter(Boolean)
      .join(' ');
    const t = `Slot ${s.slotNo}${day ? ` · ${day}` : ''}`;
    if (!seen.has(t)) out.push(t);
    seen.add(t);
  }
  return out.join('; ');
}

export async function loadRequestFacts(requestId: string): Promise<RequestFacts | null> {
  const r = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: {
      ...DEADLINE_SELECT,
      refNo: true,
      initiator: { select: { id: true, name: true, email: true } },
      offering: {
        select: {
          course: { select: { code: true, title: true, bitsCourseNumber: true } },
          semester: {
            select: {
              name: true,
              year: true,
              term: true,
              startDate: true,
              examDate: true,
              programme: {
                select: {
                  code: true,
                  name: true,
                  departmentId: true,
                  department: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      assignments: {
        where: { active: true },
        orderBy: { assignedAt: 'asc' },
        select: { faculty: { select: { id: true, name: true, email: true } } },
      },
      smeAssignment: { select: { smeUser: { select: { id: true, name: true, email: true } } } },
      assignees: {
        where: { endedAt: null, role: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] } },
        orderBy: { assignedAt: 'desc' },
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
      },
      handout: {
        select: {
          currentVersion: { select: { versionNo: true, notes: true, createdAt: true } },
        },
      },
    },
  });
  if (!r) return null;
  const sem = r.offering.semester;
  const course = r.offering.course;
  const code = course.bitsCourseNumber ?? course.code;

  const [cfg, dibba, leads, timeline] = await Promise.all([
    loadDeadlineConfig(),
    prisma.dibbaEntry.findMany({
      where: {
        import: { status: 'PUBLISHED', term: { year: sem.year, term: sem.term } },
        OR: [{ courseCode: code }, { course: { bitsCourseNumber: code } }],
      },
      select: { slotNo: true, slotDay: true, slotSession: true },
      orderBy: { slotNo: 'asc' },
    }),
    prisma.courseInstructor.findMany({
      where: { courseCode: code, isLead: true, term: { year: sem.year, term: sem.term } },
      select: { userId: true },
    }),
    requestTimeline(r.id),
  ]);
  const leadIds = new Set(leads.map((l) => l.userId));

  // No HOG recorded yet (older requests): the department's HOG, as notifications do.
  const hogU =
    r.assignees.find((a) => a.role === RoleName.HOG)?.user ??
    (sem.programme.departmentId
      ? await prisma.user.findFirst({
          where: {
            ...ACTIVE_USER_FILTER,
            departmentId: sem.programme.departmentId,
            roles: { some: { role: { name: RoleName.HOG } } },
          },
          select: { id: true, name: true, email: true },
        })
      : null);
  const pcU = r.assignees.find((a) => a.role === RoleName.PROGRAMME_COMMITTEE)?.user ?? null;
  const smeU = r.smeAssignment?.smeUser ?? null;
  const facultyU = r.assignments.map((a) => a.faculty);
  const everyone = [r.initiator, hogU, pcU, smeU, ...facultyU].filter(
    (u): u is { id: string; name: string; email: string } => !!u,
  );
  const away = await awayByUser([...new Set(everyone.map((u) => u.id))]);
  const person = (u: { id: string; name: string; email: string } | null): FactPerson | null =>
    u ? { ...u, note: awayText(away.get(u.id)) } : null;

  const deadlines = deadlinesFor(deadlineInput(r), cfg);
  const v = r.handout?.currentVersion ?? null;
  return {
    id: r.id,
    refNo: r.refNo,
    status: r.status,
    statusText: statusLabel(r.status),
    course: { code: course.code, title: course.title },
    semester: { name: sem.name, startDate: sem.startDate, examDate: sem.examDate },
    programme: { code: sem.programme.code, name: sem.programme.name },
    department: sem.programme.department?.name ?? null,
    version: v ? { no: v.versionNo, note: v.notes, at: v.createdAt } : null,
    slot: slotText(dibba),
    people: {
      ic: person(r.initiator),
      hog: person(hogU),
      pc: person(pcU),
      faculty: facultyU
        .map((u) => ({ ...person(u)!, lead: leadIds.has(u.id) }))
        .sort((a, b) => Number(b.lead) - Number(a.lead)),
      sme: person(smeU),
    },
    deadlines,
    current: deadlines.find((d) => d.state === 'current') ?? null,
    timeline,
  };
}

/** The "Handout details" box. Rows without a value are left out. */
export function detailRows(f: RequestFacts): EmailRow[] {
  const rows: (EmailRow | null)[] = [
    { label: 'Course', value: `${f.course.code} — ${f.course.title}` },
    {
      label: 'Semester',
      value: `${f.semester.name} (starts ${formatDueDay(f.semester.startDate)})`,
    },
    { label: 'Programme', value: `${f.programme.name} (${f.programme.code})` },
    f.department ? { label: 'Department', value: f.department } : null,
    { label: 'HMP reference', value: f.refNo },
    { label: 'Status now', value: f.statusText },
    f.version
      ? { label: 'Version', value: `${f.version.no} · saved ${formatDueDay(f.version.at)}` }
      : null,
    f.slot ? { label: 'Course Dibba', value: f.slot } : null,
    f.semester.examDate ? { label: 'Exams from', value: formatDueDay(f.semester.examDate) } : null,
  ];
  return rows.filter((x): x is EmailRow => !!x);
}

/** The "People" box: only the roles this request has so far. */
export function peopleRows(f: RequestFacts): EmailPerson[] {
  const p = f.people;
  const out: EmailPerson[] = [];
  const add = (role: string, u: FactPerson | null, extra?: string | null) => {
    if (u)
      out.push({
        role,
        name: u.name,
        email: u.email,
        note: [extra, u.note].filter(Boolean).join(' · ') || null,
      });
  };
  add('Instruction Cell', p.ic);
  add('Head of Group', p.hog);
  add('Programme Committee', p.pc);
  for (const fac of p.faculty) add('Faculty', fac, fac.lead ? 'Instructor-in-Charge' : null);
  add('SME', p.sme);
  return out;
}

/** The last few steps, oldest first: "05 Nov 2026 · HOG allocated the faculty". */
export function recentSteps(f: RequestFacts, n = 5): { day: string; text: string }[] {
  return f.timeline.slice(-n).map((e) => ({
    day: formatDueDay(e.at),
    text: `${e.sentence}${e.actorName ? ` — ${e.actorName}` : ''}${e.detail ? ` (${e.detail})` : ''}`,
  }));
}
