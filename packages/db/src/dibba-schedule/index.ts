import { STANDARD_SLOTS, type SlotDay, type SlotSession } from '../dibba-slots';

/**
 * Course Dibba — faculty schedule core (Phase 5, docs/plans/phase-5-course-dibba.md).
 * PURE: no Prisma, no I/O. The loader in ./load.ts fetches rows and hands them
 * here; the page renders the result. Unit-tested in isolation.
 *
 * Vocabulary (spec §10.1 is still open): "slot", "class time", "exam date".
 */

export type InstructorSourceKind = 'assignment' | 'instructor';

export interface ScheduleTerm {
  id: string;
  name: string;
  year: number;
  term: string;
  startDate: Date;
  endDate: Date;
}

export interface PublishedImportRef {
  id: string;
  label: string;
  publishedAt: Date | null;
}

export interface CatalogueCourseLike {
  bitsCourseNumber: string;
  alternateCodes: string[];
}

export interface EntryLike {
  courseCode: string;
  courseTitle: string;
  slotNo: number;
  slotDay: string | null;
  slotSession: string | null;
  programmeCode: string;
  programmeTitle: string;
  admitBatch: string | null;
  studentCount: number | null;
  isBacklogRow: boolean;
  classTimeHint: string | null;
}

export interface InstructorLike {
  courseCode: string;
  userId: string;
  userName: string;
  isLead: boolean;
}

export interface SlotTimingLike {
  slotNo: number;
  day: string;
  session: string;
  startTime: string | null;
  endTime: string | null;
}

export interface ExamDateLike {
  slotNo: number;
  kind: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
}

export interface ScheduleProgrammeRow {
  programmeCode: string;
  programmeTitle: string;
  admitBatch: string | null;
  studentCount: number | null;
  isBacklogRow: boolean;
}

export interface ScheduleSlot {
  slotNo: number;
  day: string | null;
  session: string | null;
  startTime: string | null;
  endTime: string | null;
  /** The Dibba's own hint (e.g. "SAT 8:20") when the term has no class time for the slot. */
  classTimeHint: string | null;
  rows: ScheduleProgrammeRow[];
  students: number;
  exams: ExamDateLike[];
  clash: boolean;
}

export interface ScheduleCourse {
  /** Stable grouping key (catalogue course number, or a title key). */
  key: string;
  codes: string[];
  title: string;
  slots: ScheduleSlot[];
  students: number;
  coInstructors: Array<{ name: string; isLead: boolean }>;
  sources: InstructorSourceKind[];
  clash: boolean;
}

export interface Clash {
  slotNo: number;
  day: string | null;
  session: string | null;
  courseKeys: string[];
  codes: string[];
}

export interface GridSlot {
  slotNo: number;
  day: SlotDay;
  session: SlotSession;
  startTime: string | null;
  endTime: string | null;
  courseKeys: string[];
  codes: string[];
  clash: boolean;
}

export interface FacultySchedule {
  term: ScheduleTerm | null;
  published: PublishedImportRef | null;
  courses: ScheduleCourse[];
  /** Slot 0 rows (dissertation / project): never on the grid, never a clash. */
  noSlot: ScheduleCourse[];
  clashes: Clash[];
  grid: GridSlot[];
}

export interface NextClass {
  date: Date;
  slotNo: number;
  day: string;
  session: string;
  startTime: string | null;
  endTime: string | null;
  codes: string[];
}

export interface NextExam {
  date: Date;
  kind: string;
  slotNo: number;
  startTime: string | null;
  codes: string[];
}

export interface NextEvents {
  nextClass: NextClass | null;
  nextExam: NextExam | null;
}

export const EMPTY_SCHEDULE: FacultySchedule = {
  term: null,
  published: null,
  courses: [],
  noSlot: [],
  clashes: [],
  grid: [],
};

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ---------------------------------------------------------------------------
// Active term (plan D2)
// ---------------------------------------------------------------------------

export interface TermCandidate {
  startDate: Date;
  endDate: Date;
  hasPublished: boolean;
  /** When the published import was published; breaks ties between terms that both contain today. */
  publishedAt?: Date | null;
}

/**
 * Among terms with a published import: the one containing today (the END date
 * counts as a whole day — term dates are stored as local midnight), the most
 * recently published first; else the next upcoming; else the most recently
 * ended. Null when none has a published import.
 */
export function pickActiveTerm<T extends TermCandidate>(terms: T[], now: Date): T | null {
  const published = terms.filter((t) => t.hasPublished);
  const today = startOfDay(now);
  const byLatestPublish = (a: T, b: T) =>
    (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  const current = published
    .filter((t) => t.startDate <= now && today <= t.endDate)
    .sort(byLatestPublish);
  if (current[0]) return current[0];
  const upcoming = published
    .filter((t) => t.startDate > now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (upcoming[0]) return upcoming[0];
  const past = published
    .filter((t) => t.endDate < today)
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  return past[0] ?? null;
}

// ---------------------------------------------------------------------------
// Grouping (plan D4)
// ---------------------------------------------------------------------------

const normCode = (c: string): string => c.trim().toUpperCase().replace(/\s+/g, ' ');

/** Lower-case, letters/digits/spaces only, collapsed — two spellings of one title match. */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** code → catalogue course number, for every code the catalogue knows (number or alternate). */
export function buildCodeGroups(catalogue: CatalogueCourseLike[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of catalogue) {
    const key = normCode(c.bitsCourseNumber);
    map.set(key, key);
    for (const alt of c.alternateCodes) {
      const a = normCode(alt);
      if (!map.has(a)) map.set(a, key);
    }
  }
  return map;
}

export function groupKeyFor(code: string, title: string, codeGroups: Map<string, string>): string {
  return codeGroups.get(normCode(code)) ?? `title:${normalizeTitleKey(title)}`;
}

/**
 * ONE group key per code, decided from all of a code's rows: the catalogue course
 * number when the catalogue knows the code (number or alternate); otherwise a
 * key from the code's most common normalized title, so codes the catalogue does
 * not know still merge when they share a title (spec §6) but a single code can
 * never split into two cards because two programme tables spell its title
 * differently (the 2025 Dibba has 24 such codes).
 */
export function buildGroupKeys(
  entries: ReadonlyArray<Pick<EntryLike, 'courseCode' | 'courseTitle'>>,
  catalogue: CatalogueCourseLike[],
): Map<string, string> {
  const codeGroups = buildCodeGroups(catalogue);
  const titleVotes = new Map<string, Map<string, number>>();
  const firstSeen: string[] = [];
  for (const e of entries) {
    const code = normCode(e.courseCode);
    let votes = titleVotes.get(code);
    if (!votes) {
      votes = new Map();
      titleVotes.set(code, votes);
      firstSeen.push(code);
    }
    const t = normalizeTitleKey(e.courseTitle);
    votes.set(t, (votes.get(t) ?? 0) + 1);
  }
  const keys = new Map<string, string>();
  for (const code of firstSeen) {
    const known = codeGroups.get(code);
    if (known) {
      keys.set(code, known);
      continue;
    }
    let best = '';
    let bestVotes = -1;
    for (const [t, n] of titleVotes.get(code)!) {
      if (n > bestVotes) {
        best = t;
        bestVotes = n;
      }
    }
    keys.set(code, `title:${best}`);
  }
  return keys;
}

/** Every code equivalent to one of `codes` according to the catalogue, plus the codes themselves. */
export function expandEquivalentCodes(
  codes: Iterable<string>,
  catalogue: CatalogueCourseLike[],
): Set<string> {
  const out = new Set<string>();
  const wanted = new Set([...codes].map(normCode));
  for (const w of wanted) out.add(w);
  for (const c of catalogue) {
    const all = [c.bitsCourseNumber, ...c.alternateCodes].map(normCode);
    if (all.some((a) => wanted.has(a))) for (const a of all) out.add(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build (plan D3–D6)
// ---------------------------------------------------------------------------

export interface BuildScheduleInput {
  term: ScheduleTerm;
  published: PublishedImportRef;
  /** Entries of the PUBLISHED import whose code is one of mine (already filtered by the loader). */
  entries: EntryLike[];
  /** Which source(s) put each of my codes on the list. */
  sources: Map<string, Set<InstructorSourceKind>>;
  /** Instructor rows (both sources) for my codes, everyone included; `myUserId` is dropped. */
  instructors: InstructorLike[];
  myUserId: string;
  catalogue: CatalogueCourseLike[];
  timings: SlotTimingLike[];
  examDates: ExamDateLike[];
}

export function buildSchedule(input: BuildScheduleInput): FacultySchedule {
  const groupKeys = buildGroupKeys(input.entries, input.catalogue);
  const timingBySlot = new Map(input.timings.map((t) => [t.slotNo, t] as const));
  const examsBySlot = new Map<number, ExamDateLike[]>();
  for (const e of input.examDates) {
    const list = examsBySlot.get(e.slotNo) ?? [];
    list.push(e);
    examsBySlot.set(e.slotNo, list);
  }
  for (const list of examsBySlot.values()) list.sort((a, b) => a.date.getTime() - b.date.getTime());

  type Draft = {
    key: string;
    codes: Set<string>;
    title: string;
    slots: Map<number, ScheduleSlot>;
    sources: Set<InstructorSourceKind>;
  };
  const groups = new Map<string, Draft>();
  for (const e of input.entries) {
    const code = normCode(e.courseCode);
    const key = groupKeys.get(code)!;
    let g = groups.get(key);
    if (!g) {
      g = { key, codes: new Set(), title: e.courseTitle, slots: new Map(), sources: new Set() };
      groups.set(key, g);
    }
    g.codes.add(code);
    for (const s of input.sources.get(code) ?? []) g.sources.add(s);
    let slot = g.slots.get(e.slotNo);
    if (!slot) {
      const timing = timingBySlot.get(e.slotNo);
      slot = {
        slotNo: e.slotNo,
        day: timing?.day ?? e.slotDay,
        session: timing?.session ?? e.slotSession,
        startTime: timing?.startTime ?? null,
        endTime: timing?.endTime ?? null,
        classTimeHint: null,
        rows: [],
        students: 0,
        exams: examsBySlot.get(e.slotNo) ?? [],
        clash: false,
      };
      g.slots.set(e.slotNo, slot);
    }
    if (!slot.classTimeHint && e.classTimeHint) slot.classTimeHint = e.classTimeHint;
    slot.rows.push({
      programmeCode: e.programmeCode,
      programmeTitle: e.programmeTitle,
      admitBatch: e.admitBatch,
      studentCount: e.studentCount,
      isBacklogRow: e.isBacklogRow,
    });
    slot.students += e.studentCount ?? 0;
  }

  // Clashes: a slot (≥ 1) shared by two different groups.
  const groupsBySlot = new Map<number, Set<string>>();
  for (const g of groups.values()) {
    for (const slotNo of g.slots.keys()) {
      if (slotNo < 1) continue;
      const set = groupsBySlot.get(slotNo) ?? new Set<string>();
      set.add(g.key);
      groupsBySlot.set(slotNo, set);
    }
  }
  const clashes: Clash[] = [];
  for (const [slotNo, keys] of [...groupsBySlot.entries()].sort((a, b) => a[0] - b[0])) {
    if (keys.size < 2) continue;
    const timing = timingBySlot.get(slotNo);
    const std = STANDARD_SLOTS.find((s) => s.slotNo === slotNo);
    const courseKeys = [...keys].sort();
    const codes = courseKeys.flatMap((k) => [...groups.get(k)!.codes].sort());
    clashes.push({
      slotNo,
      day: timing?.day ?? std?.day ?? null,
      session: timing?.session ?? std?.session ?? null,
      courseKeys,
      codes,
    });
    for (const k of courseKeys) groups.get(k)!.slots.get(slotNo)!.clash = true;
  }

  // Co-instructors per group: anyone (but me) on any of the group's codes.
  const instructorsByCode = new Map<string, InstructorLike[]>();
  for (const i of input.instructors) {
    const c = normCode(i.courseCode);
    const list = instructorsByCode.get(c) ?? [];
    list.push(i);
    instructorsByCode.set(c, list);
  }

  const toCourse = (g: Draft): ScheduleCourse => {
    const seen = new Map<string, { name: string; isLead: boolean }>();
    for (const code of g.codes) {
      for (const i of instructorsByCode.get(code) ?? []) {
        if (i.userId === input.myUserId) continue;
        const cur = seen.get(i.userId);
        if (cur) cur.isLead = cur.isLead || i.isLead;
        else seen.set(i.userId, { name: i.userName, isLead: i.isLead });
      }
    }
    const slots = [...g.slots.values()].sort((a, b) => a.slotNo - b.slotNo);
    return {
      key: g.key,
      codes: [...g.codes].sort(),
      title: g.title,
      slots,
      students: slots.reduce((n, s) => n + s.students, 0),
      coInstructors: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sources: [...g.sources].sort(),
      clash: slots.some((s) => s.clash),
    };
  };

  const all = [...groups.values()]
    .map(toCourse)
    .sort((a, b) => a.codes[0]!.localeCompare(b.codes[0]!));
  const courses = all.filter((c) => c.slots.some((s) => s.slotNo >= 1));
  const noSlot = all.filter((c) => c.slots.every((s) => s.slotNo < 1));

  const grid: GridSlot[] = STANDARD_SLOTS.map((std) => {
    const timing = timingBySlot.get(std.slotNo);
    const keys = [...(groupsBySlot.get(std.slotNo) ?? [])].sort();
    return {
      slotNo: std.slotNo,
      day: std.day,
      session: std.session,
      startTime: timing?.startTime ?? null,
      endTime: timing?.endTime ?? null,
      courseKeys: keys,
      codes: keys.flatMap((k) => [...groups.get(k)!.codes].sort()),
      clash: keys.length > 1,
    };
  });

  return { term: input.term, published: input.published, courses, noSlot, clashes, grid };
}

// ---------------------------------------------------------------------------
// Next class / next exam (plan D7)
// ---------------------------------------------------------------------------

const WEEKDAY: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** "HH:MM" → minutes since midnight; null when unset. */
const minutes = (t: string | null): number | null => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Next class = the earliest upcoming occurrence of one of my slots (today counts
 * until the class has ended; unknown end → until midnight); next exam = the
 * earliest exam date on or after today among my slots. Both name EVERY course
 * sharing that slot or date (so a clash shows both). Wall-clock arithmetic in the
 * process's zone: the web process pins TZ=Asia/Kolkata in deploy/ecosystem.config.cjs.
 */
export function nextEvents(schedule: FacultySchedule, now: Date): NextEvents {
  const today = startOfDay(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let nextClass: NextClass | null = null;
  let nextExam: NextExam | null = null;
  const classCodes = new Map<string, Set<string>>(); // `${date}|${slotNo}` → codes
  const examCodes = new Map<string, Set<string>>(); // `${date}|${kind}` → codes
  for (const course of schedule.courses) {
    for (const slot of course.slots) {
      if (slot.slotNo < 1 || !slot.day) continue;
      const wd = WEEKDAY[slot.day];
      if (wd === undefined) continue;
      let delta = (wd - today.getDay() + 7) % 7;
      const end = minutes(slot.endTime);
      if (delta === 0 && end !== null && nowMinutes >= end) delta = 7;
      const date = new Date(today);
      date.setDate(date.getDate() + delta);
      const ck = `${date.getTime()}|${slot.slotNo}`;
      const cset = classCodes.get(ck) ?? new Set<string>();
      for (const c of course.codes) cset.add(c);
      classCodes.set(ck, cset);
      const startM = minutes(slot.startTime) ?? 0;
      const better =
        !nextClass ||
        date < nextClass.date ||
        (date.getTime() === nextClass.date.getTime() &&
          startM < (minutes(nextClass.startTime) ?? 0));
      if (better) {
        nextClass = {
          date,
          slotNo: slot.slotNo,
          day: slot.day,
          session: slot.session ?? '',
          startTime: slot.startTime,
          endTime: slot.endTime,
          codes: [],
        };
      }
      for (const exam of slot.exams) {
        const examDay = startOfDay(exam.date);
        if (examDay < today) continue;
        const ek = `${examDay.getTime()}|${exam.kind}`;
        const eset = examCodes.get(ek) ?? new Set<string>();
        for (const c of course.codes) eset.add(c);
        examCodes.set(ek, eset);
        if (!nextExam || examDay < nextExam.date) {
          nextExam = {
            date: examDay,
            kind: exam.kind,
            slotNo: slot.slotNo,
            startTime: exam.startTime,
            codes: [],
          };
        }
      }
    }
  }
  if (nextClass) {
    const set = classCodes.get(`${nextClass.date.getTime()}|${nextClass.slotNo}`);
    nextClass.codes = [...(set ?? [])].sort();
  }
  if (nextExam) {
    const set = examCodes.get(`${nextExam.date.getTime()}|${nextExam.kind}`);
    nextExam.codes = [...(set ?? [])].sort();
  }
  return { nextClass, nextExam };
}
