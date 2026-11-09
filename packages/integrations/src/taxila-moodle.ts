/**
 * Publishing into Taxila (Moodle) — "Mode C" (docs/plans/taxila-publish.md §B1), with the fixed-name
 * rule of v1.3.1 that was proven in CIL_Exp on 6 Nov 2026.
 *
 * IT's QPM method (local-data/taxila_sync_approach.docx), aimed at one File item per course:
 *   1. core_course_search_courses (criterianame=search, criteriavalue=<semester code>) — GET
 *   2. match the course locally on `fullname`, case-insensitive
 *   3. core_course_get_contents (courseid) → section "General" → the File item (modname "resource
 * The token is Moodle's to read, nobody else's: upload.php carries it in the URL, so every message
 * that leaves this module goes through `redact()` first. Never log a URL from here unredacted.
 */

export interface TaxilaConfig {
  /** "https://taxila-aws.bits-pilani.ac.in/webservice/" — trailing slash kept, as IT's doc says. */
  url: string;
  token: string;
  timeoutMs?: number;
  /** Waits between retries (tests pass 0s). */
  backoffMs?: number[];
}

export type TaxilaStep = 'search' | 'match' | 'item' | 'upload' | 'move' | 'verify';

export type TaxilaErrorKind =
  | 'timeout'
  | 'http'
  | 'refused' // a Moodle exception (bad token, function not allowed, …)
  | 'bad-response'
  | 'move-failed'
  | 'not-confirmed'; // the read-back after publishing didn't show exactly our file

export class TaxilaError extends Error {
  constructor(
    message: string,
    public readonly step: TaxilaStep,
    public readonly kind: TaxilaErrorKind,
  ) {
    super(message);
    this.name = 'TaxilaError';
  }
}

export interface TaxilaCourse {
  id: number;
  fullname: string;
  shortname: string;
}

/** The File item (mod_resource) every course keeps in General for its handout. */
export const TAXILA_HANDOUT_ITEM = 'Course Handout';
/** The only file that item may hold — every publish replaces it. */
export const TAXILA_HANDOUT_FILE = 'Course Handout.pdf';

export interface TaxilaHandoutItem {
  moduleId: number;
  contextid: number;
  files: { name: string; size: number | null }[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BACKOFF_MS = [1_000, 3_000];

/** Mode C is on when both settings are present (env only). */
export function taxilaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TaxilaConfig | null {
  const url = (env.TAXILA_URL ?? '').trim();
  const token = (env.TAXILA_TOKEN ?? '').trim();
  if (!url || !token) return null;
  return { url: url.endsWith('/') ? url : `${url}/`, token };
}

/** "https://taxila…/webservice/" → "https://taxila…/course/view.php?id=4567". */
export function taxilaCourseUrl(cfg: Pick<TaxilaConfig, 'url'>, courseId: number): string {
  const site = cfg.url.replace(/webservice\/?$/, '');
  return `${site}course/view.php?id=${courseId}`;
}

/** Removes the token — and any token-looking query value — from text meant for people or logs. */
export function redact(text: string, token: string): string {
  let out = text;
  if (token) out = out.split(token).join('[token]');
  return out.replace(/((?:ws)?token=)[^&\s"']+/gi, '$1[token]');
}

const squash = (s: string) => s.replace(/\s+/g, '').toUpperCase();

export type CourseMatch =
  | { kind: 'found'; course: TaxilaCourse }
  | { kind: 'none' }
  | { kind: 'ambiguous'; courses: TaxilaCourse[] };

/**
 * IT's rule, case-insensitive on `fullname`, on Taxila's real names (taxila-discover.log, 5 Nov):
 * - a course under one code: "Software Architectures (S1-25_SSZG653)" — the fullname contains
 *   "<SEMESTER>_<CODE without spaces>";
 * - a merged course: "Software Architectures (Merged - SEZG651/SSZG653)(S1-25)" — "Merged", the
 *   semester and the course code. Merged lists change by semester, so any one of the codes counts.
 * A handout with several codes (cross-listed) looks for the merged course first; one with a single
 * code looks for its own course first. Either falls back to the other way. Codes must stand alone
 * (CCZG501 never matches MBACCZG501, SSZG653 never SSZG6531 or SSZG653T). More than one match is
 * never guessed — the IC picks. Backlog and Tentative shells ("… (S1-26_DMZG631)Backlog",
 * "Dissertation (S1-26_Tentative)", taxila-discover2.log, 6 Nov) are never matched: students of the
 * regular offering aren't in them.
 */
export function matchTaxilaCourse(
  courses: TaxilaCourse[],
  semesterCode: string,
  codes: string[],
): CourseMatch {
  const sem = squash(semesterCode);
  const wanted = [...new Set(codes.map(squash))];
  // Names keep their spaces (codes in them are written without); only codes are squashed.
  const norm = (name: string) => name.toUpperCase().replace(/\s+/g, ' ');
  const alone = (hay: string, needle: string) => {
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      const before = hay[i - 1];
      const after = hay[i + needle.length];
      if ((!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))) return true;
    }
    return false;
  };
  const single = (name: string) => wanted.some((code) => alone(name, `${sem}_${code}`));
  const merged = (name: string) =>
    /\bMERGED\b/.test(name) && alone(name, sem) && wanted.some((code) => alone(name, code));
  const excluded = (name: string) => /\b(BACKLOG|TENTATIVE)\b/.test(name);
  const pick = (test: (name: string) => boolean): TaxilaCourse[] => [
    ...new Map(
      courses
        .filter((c) => {
          const name = norm(c.fullname);
          return !excluded(name) && test(name);
        })
        .map((c) => [c.id, c]),
    ).values(),
  ];

  const [first, second] = wanted.length > 1 ? [merged, single] : [single, merged];
  let hits = pick(first);
  if (hits.length === 0) hits = pick(second);
  if (hits.length === 0) return { kind: 'none' };
  if (hits.length === 1) return { kind: 'found', course: hits[0]! };
  return { kind: 'ambiguous', courses: hits };
}

/**
 * Finds General → the File item named "Course Handout" (case and surrounding spaces don't matter).
 * Folders and other items are ignored, whatever they're called.
 */
export function findHandoutItem(contents: unknown): TaxilaHandoutItem | null {
  if (!Array.isArray(contents)) return null;
  const general = contents.find(
    (s) =>
      s &&
      typeof s === 'object' &&
      String((s as { name?: unknown }).name ?? '').trim() === 'General',
  ) as { modules?: unknown[] } | undefined;
  const wanted = TAXILA_HANDOUT_ITEM.toLowerCase();
  const item = (general?.modules ?? []).find((m) => {
    const mod = m as { modname?: unknown; name?: unknown };
    return (
      mod.modname === 'resource' &&
      String(mod.name ?? '')
        .trim()
        .toLowerCase() === wanted
    );
  }) as { id?: unknown; contextid?: unknown; contents?: unknown[] } | undefined;
  if (!item || typeof item.contextid !== 'number') return null;
  const files = (item.contents ?? [])
    .map((f) => f as { type?: unknown; filename?: unknown; filesize?: unknown })
    .filter((f) => (f.type ?? 'file') === 'file' && typeof f.filename === 'string')
    .map((f) => ({
      name: f.filename as string,
      size: typeof f.filesize === 'number' ? f.filesize : null,
    }));
  return { moduleId: Number(item.id ?? 0), contextid: item.contextid, files };
}

function moodleError(json: unknown): { errorcode: string; message: string } | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const j = json as {
    exception?: unknown;
    errorcode?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (!j.exception && !j.errorcode && !j.error) return null;
  return {
    errorcode: String(j.errorcode ?? ''),
    message: String(j.message ?? j.error ?? 'Taxila returned an error'),
  };
}

function refusedMessage(fn: string, e: { errorcode: string; message: string }): string {
  if (/invalidtoken/i.test(e.errorcode))
    return 'Taxila refused the HMP token — ask IT to check it.';
  if (/accessexception|nopermission|required_capability|servicenotavailable/i.test(e.errorcode))
    return `Taxila refused: the HMP token can't call ${fn} — ask IT.`;
  return `Taxila refused ${fn}: ${e.message}`;
}

export interface TaxilaClient {
  searchCourses(semesterCode: string): Promise<TaxilaCourse[]>;
  getHandoutItem(courseId: number): Promise<TaxilaHandoutItem | null>;
  upload(fileName: string, pdf: Buffer): Promise<number>;
  moveIntoItem(draftItemId: number, contextid: number): Promise<void>;
}

export function createTaxilaClient(
  cfg: TaxilaConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): TaxilaClient {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = cfg.backoffMs ?? DEFAULT_BACKOFF_MS;
  const clean = (s: string) => redact(s, cfg.token);

  /** One HTTP call with a timeout; returns parsed JSON. Errors carry no token. */
  async function call(step: TaxilaStep, url: string, init: RequestInit): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: ac.signal });
    } catch (err) {
      const aborted = (err as { name?: string }).name === 'AbortError';
      throw new TaxilaError(
        aborted
          ? `Taxila didn’t answer in ${Math.round(timeoutMs / 1000)} s.`
          : clean(`Couldn't reach Taxila: ${(err as Error).message}`),
        step,
        aborted ? 'timeout' : 'http',
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new TaxilaError(`Taxila answered HTTP ${res.status}.`, step, 'http');
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new TaxilaError('Taxila sent something that isn’t JSON.', step, 'bad-response');
    }
  }

  /** Retries timeouts, network errors and 5xx — never for the move (it isn't safe to repeat). */
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const retryable =
          err instanceof TaxilaError &&
          (err.kind === 'timeout' || (err.kind === 'http' && !/HTTP 4\d\d/.test(err.message)));
        if (!retryable || attempt >= backoff.length) throw err;
        await new Promise((r) => setTimeout(r, backoff[attempt]));
      }
    }
  }

  const rest = (fn: string, params: Record<string, string | number>) => {
    const q = new URLSearchParams({
      wstoken: cfg.token,
      wsfunction: fn,
      moodlewsrestformat: 'json',
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    return `${cfg.url}rest/server.php?${q}`;
  };

  return {
    async searchCourses(semesterCode) {
      const fn = 'core_course_search_courses';
      const json = await withRetry(() =>
        call('search', rest(fn, { criterianame: 'search', criteriavalue: semesterCode }), {
          method: 'GET',
        }),
      );
      const err = moodleError(json);
      if (err) throw new TaxilaError(clean(refusedMessage(fn, err)), 'search', 'refused');
      const courses = (json as { courses?: unknown }).courses;
      if (!Array.isArray(courses))
        throw new TaxilaError(
          'Taxila’s course search answer had no course list.',
          'search',
          'bad-response',
        );
      return courses.map((c) => {
        const x = c as { id?: unknown; fullname?: unknown; shortname?: unknown };
        return {
          id: Number(x.id),
          fullname: String(x.fullname ?? ''),
          shortname: String(x.shortname ?? ''),
        };
      });
    },

    async getHandoutItem(courseId) {
      const fn = 'core_course_get_contents';
      const json = await withRetry(() =>
        call('item', rest(fn, { courseid: courseId }), { method: 'GET' }),
      );
      const err = moodleError(json);
      if (err) throw new TaxilaError(clean(refusedMessage(fn, err)), 'item', 'refused');
      return findHandoutItem(json);
    },

    async upload(fileName, pdf) {
      const json = await withRetry(() => {
        const form = new FormData();
        form.append(
          'file_1',
          new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
          fileName,
        );
        const url = `${cfg.url}upload.php?${new URLSearchParams({ token: cfg.token })}`;
        return call('upload', url, { method: 'POST', body: form });
      });
      const err = moodleError(json);
      if (err) throw new TaxilaError(clean(refusedMessage('upload.php', err)), 'upload', 'refused');
      const itemid = Array.isArray(json)
        ? (json[0] as { itemid?: unknown } | undefined)?.itemid
        : undefined;
      if (typeof itemid !== 'number')
        throw new TaxilaError(
          'Upload failed: Taxila didn’t return a draft item id.',
          'upload',
          'bad-response',
        );
      return itemid;
    },

    async moveIntoItem(draftItemId, contextid) {
      const fn = 'local_move_file_from_draft';
      const body = new URLSearchParams({
        wstoken: cfg.token,
        wsfunction: fn,
        moodlewsrestformat: 'json',
        draftitemid: String(draftItemId),
        contextid: String(contextid),
        component: 'mod_resource',
        filearea: 'content',
        itemid: '0',
      });
      const json = await call('move', `${cfg.url}rest/server.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const err = moodleError(json);
      if (err) throw new TaxilaError(clean(refusedMessage(fn, err)), 'move', 'refused');
      if ((json as { status?: unknown } | null)?.status !== 'success')
        throw new TaxilaError(
          'Move failed: Taxila didn’t confirm the file was placed.',
          'move',
          'move-failed',
        );
    },
  };
}

// ── The two operations HMP offers ───────────────────────────────────────────

type Found = { course: TaxilaCourse; courseUrl: string };

export type CheckResult =
  | (Found & {
      status: 'ready';
      item: TaxilaHandoutItem;
      /** The item already holds a "Course Handout.pdf" (the placeholder or the last publish). */
      replaces: boolean;
      message: string;
    })
  | { status: 'not-found'; message: string }
  | { status: 'ambiguous'; courses: TaxilaCourse[]; message: string }
  | (Found & { status: 'item-missing'; message: string })
  | (Found & {
      status: 'other-files';
      item: TaxilaHandoutItem;
      /** Files that must go before HMP may publish — students would open one of these instead. */
      others: string[];
      message: string;
    });

const quoteList = (names: string[]) => {
  const q = names.map((n) => `'${n}'`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
};

export const itemMissingMessage = () =>
  `Create a File named '${TAXILA_HANDOUT_ITEM}' in General with a placeholder named ${TAXILA_HANDOUT_FILE}, then check again.`;

export const otherFilesMessage = (others: string[]) =>
  `Remove ${quoteList(others)} from ${TAXILA_HANDOUT_ITEM} first, so students see the published handout.`;

/** Every file in the item that isn't exactly "Course Handout.pdf" (a different case counts too). */
export const otherFiles = (item: TaxilaHandoutItem) =>
  item.files.map((f) => f.name).filter((n) => n !== TAXILA_HANDOUT_FILE);

/**
 * "Check in Taxila": finds the course and its Course Handout item and says whether HMP may publish
 * into it — without uploading anything. `courses` lets a bulk run reuse one search; `courseId`
 * applies the IC's pick when several courses matched; `chosen` is a remembered choice (v1.4.1).
 */
export async function checkInTaxila(
  client: TaxilaClient,
  cfg: Pick<TaxilaConfig, 'url'>,
  input: {
    semesterCode: string;
    codes: string[];
    courses?: TaxilaCourse[];
    courseId?: number;
    /** v1.4.1: a course the IC chose ("Choose a different Taxila course") — used as it is, no search. */
    chosen?: TaxilaCourse;
  },
): Promise<CheckResult> {
  let course: TaxilaCourse | undefined = input.chosen;
  const courses = course ? [] : (input.courses ?? (await client.searchCourses(input.semesterCode)));
  if (!course && input.courseId) course = courses.find((c) => c.id === input.courseId);
  if (!course) {
    const m = matchTaxilaCourse(courses, input.semesterCode, input.codes);
    const label = `${input.semesterCode}_${input.codes[0]?.replace(/\s+/g, '') ?? ''}`;
    if (m.kind === 'none')
      return { status: 'not-found', message: `Course ${label} not found in Taxila.` };
    if (m.kind === 'ambiguous')
      return {
        status: 'ambiguous',
        courses: m.courses,
        message: `More than one Taxila course matches ${label} — pick one.`,
      };
    course = m.course;
  }
  const courseUrl = taxilaCourseUrl(cfg, course.id);
  const item = await client.getHandoutItem(course.id);
  if (!item) return { status: 'item-missing', course, courseUrl, message: itemMissingMessage() };
  const others = otherFiles(item);
  if (others.length)
    return {
      status: 'other-files',
      course,
      courseUrl,
      item,
      others,
      message: otherFilesMessage(others),
    };
  const replaces = item.files.length > 0;
  return {
    status: 'ready',
    course,
    courseUrl,
    item,
    replaces,
    message: replaces
      ? `Ready to publish. It replaces the ${TAXILA_HANDOUT_FILE} there now.`
      : 'Ready to publish.',
  };
}

/** null when the item is exactly one "Course Handout.pdf" of this size; otherwise what's wrong. */
export function confirmPublished(item: TaxilaHandoutItem | null, size: number): string | null {
  if (!item) return `Uploaded, but the ${TAXILA_HANDOUT_ITEM} item is no longer in the course.`;
  const ours = item.files.find((f) => f.name === TAXILA_HANDOUT_FILE);
  if (!ours)
    return `Uploaded, but ${TAXILA_HANDOUT_FILE} isn't in the ${TAXILA_HANDOUT_ITEM} item.`;
  const others = otherFiles(item);
  if (others.length)
    return `Uploaded, but ${TAXILA_HANDOUT_ITEM} also holds ${quoteList(others)}, so students may open that instead. Remove it in Taxila, then publish again.`;
  if (ours.size !== size)
    return `Uploaded, but the ${TAXILA_HANDOUT_FILE} in Taxila isn't the new file (${ours.size ?? 'unknown'} bytes, expected ${size}).`;
  return null;
}

/**
 * Upload "Course Handout.pdf" → move it into the item (replacing the one there) → read the item
 * back. Published only when the item holds exactly our file at the new size. If the move times out
 * or its answer is lost, the read-back decides; the move is never sent twice.
 */
export async function publishFileToTaxila(
  client: TaxilaClient,
  input: { courseId: number; contextid: number; pdf: Buffer },
): Promise<void> {
  const itemid = await client.upload(TAXILA_HANDOUT_FILE, input.pdf);
  let lost: TaxilaError | null = null;
  try {
    await client.moveIntoItem(itemid, input.contextid);
  } catch (err) {
    const uncertain = err instanceof TaxilaError && (err.kind === 'timeout' || err.kind === 'http');
    if (!uncertain) throw err;
    lost = err;
  }
  let item: TaxilaHandoutItem | null;
  try {
    item = await client.getHandoutItem(input.courseId);
  } catch (err) {
    const why = err instanceof TaxilaError ? err.message : String(err);
    throw new TaxilaError(
      `Uploaded, but HMP couldn't read ${TAXILA_HANDOUT_ITEM} back to confirm it (${why}) — check the course in Taxila, then publish again.`,
      'verify',
      'not-confirmed',
    );
  }
  const problem = confirmPublished(item, input.pdf.length);
  if (!problem) return;
  if (lost) throw new TaxilaError(`Move failed: ${lost.message}`, 'move', 'move-failed');
  throw new TaxilaError(problem, 'verify', 'not-confirmed');
}

/** Sem-I 2026-27 → "S1-26", Sem-II → "S2-26"; Summer and anything else → "" (the IC types it). */
export function defaultTaxilaSemesterCode(semesterName: string): string {
  const m = /sem(?:ester)?[\s-]*(I{1,2}|1|2)\b[^\d]*(\d{4})/i.exec(semesterName);
  if (!m) return '';
  const n = /^(II|2)$/i.test(m[1]!) ? 2 : 1;
  return `S${n}-${m[2]!.slice(2)}`;
}
