import { prisma, HandoutStatus, RoleName, type Prisma } from '@hmp/db';
import {
  DEADLINE_SELECT,
  STAGE_HOLDER,
  deadlineInput,
  deadlinesFor,
  istDay,
  loadDeadlineConfig,
} from './deadlines';
import { departmentScope, type DeptScopeUser } from './department-scope';
import { absoluteEmailLink, linkFor } from './notifications';
import { calendarTokenHash } from './preferences';

/**
 * v1.4.2 — "Add my HMP deadlines to my calendar" (F9, H21). The due dates of the steps that are this person's
 * to do — now and later — on the requests they are on. Only course code and title, the step and the date: no
 * handout content. Served at /api/calendar/<token>.ics (private link, auto-updating) and
 * /api/calendar/download (signed in).
 */

export interface CalendarEvent {
  uid: string;
  day: number; // India-time day number
  summary: string;
  description: string;
  url: string;
}

const OPEN: HandoutStatus[] = [
  HandoutStatus.REQUESTED,
  HandoutStatus.ALLOCATED,
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.APPROVED,
];

const ROLE_OF: Record<(typeof STAGE_HOLDER)[keyof typeof STAGE_HOLDER], RoleName> = {
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
  FACULTY: RoleName.FACULTY,
  SME: RoleName.SME,
  IC: RoleName.INSTRUCTION_CELL,
};

export async function calendarEvents(user: DeptScopeUser): Promise<CalendarEvent[]> {
  const cfg = await loadDeadlineConfig();
  const has = (r: RoleName) => user.roles.includes(r);
  const deptOrNamed = (role: RoleName): Prisma.HandoutRequestWhereInput => ({
    OR: [
      { assignees: { some: { role, userId: user.id, endedAt: null } } },
      { AND: [{ assignees: { none: { role, endedAt: null } } }, departmentScope(user) ?? {}] },
    ],
  });
  const or: Prisma.HandoutRequestWhereInput[] = [];
  if (has(RoleName.FACULTY))
    or.push({ assignments: { some: { facultyId: user.id, active: true } } });
  if (has(RoleName.SME)) or.push({ smeAssignment: { smeUserId: user.id } });
  if (has(RoleName.HOG)) or.push(deptOrNamed(RoleName.HOG));
  if (has(RoleName.PROGRAMME_COMMITTEE)) or.push(deptOrNamed(RoleName.PROGRAMME_COMMITTEE));
  if (has(RoleName.INSTRUCTION_CELL)) or.push({});
  if (or.length === 0) return [];

  const rows = await prisma.handoutRequest.findMany({
    where: { AND: [{ status: { in: OPEN } }, { OR: or }] },
    select: {
      ...DEADLINE_SELECT,
      refNo: true,
      offering: {
        select: {
          course: { select: { code: true, title: true } },
          semester: { select: { name: true, startDate: true } },
        },
      },
      assignees: { where: { endedAt: null }, select: { role: true, userId: true } },
      assignments: { where: { active: true }, select: { facultyId: true } },
      smeAssignment: { select: { smeUserId: true } },
    },
    take: 1000,
  });

  const events: CalendarEvent[] = [];
  for (const r of rows) {
    const named = (role: RoleName) => r.assignees.find((a) => a.role === role)?.userId;
    const mine = (holder: keyof typeof ROLE_OF): boolean => {
      const role = ROLE_OF[holder];
      if (!has(role)) return false;
      if (holder === 'FACULTY') return r.assignments.some((a) => a.facultyId === user.id);
      if (holder === 'SME') return r.smeAssignment?.smeUserId === user.id;
      if (holder === 'IC') return true;
      const n = named(role);
      return n ? n === user.id : true; // nobody named yet: the department's (query already scoped)
    };
    for (const d of deadlinesFor(deadlineInput(r), cfg)) {
      if (d.state === 'done') continue;
      if (!mine(STAGE_HOLDER[d.stage])) continue;
      const course = `${r.offering.course.code} ${r.offering.course.title}`;
      const role = ROLE_OF[STAGE_HOLDER[d.stage]];
      events.push({
        uid: `${r.id}-${d.stage}@hmp`,
        day: istDay(d.dueAt),
        summary: `HMP: ${d.label} — ${course}`,
        description: `${r.refNo} · ${r.offering.semester.name} · ${d.state === 'current' ? 'now with you' : 'coming up'}`,
        url: absoluteEmailLink(linkFor(role, r.id)),
      });
    }
  }
  return events.sort((a, b) => a.day - b.day);
}

// ---- iCalendar (RFC 5545) -----------------------------------------------------------------------

const icsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const ymd = (day: number) =>
  new Date(day * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');

/** Lines longer than 75 octets are folded (CRLF + space), counting UTF-8 bytes. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toIcs(events: CalendarEvent[], name: string, now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BITS WILP//HMP//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${icsText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.day)}`,
      `DTEND;VALUE=DATE:${ymd(e.day + 1)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `DESCRIPTION:${icsText(`${e.description}\n${e.url}`)}`,
      `URL:${icsText(e.url)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** The person behind a calendar link, or null (unknown, replaced, or switched off). */
export async function userForCalendarToken(token: string): Promise<DeptScopeUser | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const pref = await prisma.userPreference.findUnique({
    where: { calendarTokenHash: calendarTokenHash(token) },
    select: {
      user: {
        select: {
          id: true,
          active: true,
          departmentId: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      },
    },
  });
  const u = pref?.user;
  if (!u || !u.active) return null;
  return { id: u.id, departmentId: u.departmentId, roles: u.roles.map((r) => r.role.name) };
}
