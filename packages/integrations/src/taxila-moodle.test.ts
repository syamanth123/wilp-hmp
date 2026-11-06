import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TAXILA_HANDOUT_FILE,
  TaxilaError,
  checkInTaxila,
  confirmPublished,
  createTaxilaClient,
  defaultTaxilaSemesterCode,
  findHandoutItem,
  matchTaxilaCourse,
  publishFileToTaxila,
  redact,
  taxilaConfigFromEnv,
  taxilaCourseUrl,
  type TaxilaConfig,
} from './taxila-moodle';
import { sampleTaxilaCourses, startFakeMoodle, type FakeMoodle } from './testing/fake-moodle';

const TOKEN = 'tok-SECRET-0123456789abcdef';
const PDF = Buffer.from('%PDF-1.4 fake handout');

let fake: FakeMoodle;
let cfg: TaxilaConfig;

beforeEach(async () => {
  fake = await startFakeMoodle({ token: TOKEN, courses: sampleTaxilaCourses() });
  cfg = {
    url: fake.url,
    token: TOKEN,
    // Generous: the fake runs alongside every other package's tests (ci-local), and a slow answer
    // would be retried and change the call list. Tests that wait for a timeout set SHORT below.
    timeoutMs: 5_000,
    backoffMs: [0, 0],
  };
});
afterEach(() => fake.close());

const client = () => createTaxilaClient(cfg);
/** For tests where the fake deliberately never answers. */
const SHORT = 300;
const item = (id: number) => fake.courses.find((c) => c.id === id)!.item!;
const PLACEHOLDER = [{ filename: TAXILA_HANDOUT_FILE, size: 900 }];

describe('settings', () => {
  it('Mode C needs both TAXILA_URL and TAXILA_TOKEN; the trailing slash is kept', () => {
    expect(taxilaConfigFromEnv({})).toBeNull();
    expect(taxilaConfigFromEnv({ TAXILA_URL: 'https://t/webservice/' })).toBeNull();
    expect(taxilaConfigFromEnv({ TAXILA_URL: 'https://t/webservice', TAXILA_TOKEN: 'x' })).toEqual({
      url: 'https://t/webservice/',
      token: 'x',
    });
    expect(taxilaCourseUrl({ url: 'https://taxila-aws.bits-pilani.ac.in/webservice/' }, 42)).toBe(
      'https://taxila-aws.bits-pilani.ac.in/course/view.php?id=42',
    );
  });
});

describe('course matching (IT’s rule, on Taxila’s real names — taxila-discover.log)', () => {
  // Shapes copied from the real S1-25 / S1-26 search results.
  const courses = [
    { id: 1, fullname: 'Software Quality Assurance and Testing (S1-25_SEZG501)', shortname: '' },
    { id: 2, fullname: 'Software Architectures (Merged - SEZG651/SSZG653)(S1-25)', shortname: '' },
    { id: 3, fullname: 'Software Architectures (S1-25_SSZG653)', shortname: '' },
    {
      id: 4,
      fullname:
        'Quantitative Methods | Business Statistics (Merged - MBAZC417/PDBAZC417/PDFTZC417/MBAZG501)(S1-25)',
      shortname: '',
    },
    { id: 5, fullname: 'Quantitative Methods (S1-25_MBAZC417)', shortname: '' },
    {
      id: 6,
      fullname: 'Introduction to Parallel and Distributed Programming (S1-25_CCZG501)',
      shortname: '',
    },
    { id: 7, fullname: 'Business Statistics (S1-25_MBACCZG501)', shortname: '' },
    { id: 8, fullname: 'Dissertation (S1-25_SSZG628T)', shortname: '' },
    { id: 9, fullname: 'Software Architectures (S2-25_SSZG653)', shortname: '' },
  ];
  const id = (sem: string, codes: string[]) => {
    const m = matchTaxilaCourse(courses, sem, codes);
    return m.kind === 'found' ? m.course.id : m.kind;
  };

  it('one code: its own course "(<SEM>_<CODE>)", case-insensitive', () => {
    expect(id('S1-25', ['SE ZG501'])).toBe(1);
    expect(id('s1-25', ['SS ZG653'])).toBe(3); // its own course, not the merged one
    expect(id('S2-25', ['SS ZG653'])).toBe(9); // the semester matters
    expect(id('S1-25', ['SS ZG999'])).toBe('none');
  });
  it('codes stand alone: CCZG501 is not MBACCZG501; SSZG628 is not SSZG628T', () => {
    expect(id('S1-25', ['CC ZG501'])).toBe(6);
    expect(id('S1-25', ['SS ZG628'])).toBe('none');
  });
  it('several codes (cross-listed): the merged course first, by any of its codes', () => {
    expect(id('S1-25', ['MBA ZC417', 'PDBA ZC417', 'PDFT ZC417'])).toBe(4);
    expect(id('S1-25', ['SE ZG651', 'SS ZG653'])).toBe(2);
  });
  it('merged lists change by semester — one shared code is enough', () => {
    const s126 = [
      {
        id: 10,
        fullname:
          'Quantitative Methods | Business Statistics (Merged - MBAZC417/MBAZG501/PDBAZG501)(S1-26)',
        shortname: '',
      },
    ];
    expect(matchTaxilaCourse(s126, 'S1-26', ['MBA ZC417', 'PDBA ZC417'])).toMatchObject({
      kind: 'found',
      course: { id: 10 },
    });
  });
  it('falls back: one code with only a merged course, several codes with no merged course', () => {
    expect(matchTaxilaCourse([courses[1]!], 'S1-25', ['SS ZG653'])).toMatchObject({
      kind: 'found',
      course: { id: 2 },
    });
    expect(matchTaxilaCourse([courses[0]!], 'S1-25', ['SE ZG501', 'XX ZG501'])).toMatchObject({
      kind: 'found',
      course: { id: 1 },
    });
  });
  it('several matches are never guessed', () => {
    const twice = [
      ...courses,
      { id: 11, fullname: 'Software Architectures - old copy (S1-25_SSZG653)', shortname: '' },
    ];
    expect(matchTaxilaCourse(twice, 'S1-25', ['SS ZG653'])).toMatchObject({ kind: 'ambiguous' });
  });
  it('Backlog and Tentative shells are never matched (real S1-26 names)', () => {
    const s126 = [
      { id: 20, fullname: 'Additive Manufacturing Process (S1-26_DMZG631)', shortname: '' },
      { id: 21, fullname: 'Additive Manufacturing Process (S1-26_DMZG631)Backlog', shortname: '' },
      { id: 22, fullname: 'Mechanics of Solids (S1-26_MTTMZC261) - Backlog', shortname: '' },
      {
        id: 23,
        fullname: 'Software Engineering (S1-26_SESAPZC344)(Flipped)(Backlog)',
        shortname: '',
      },
      { id: 24, fullname: 'Dissertation (S1-26_SESAPZG628T)-Backlog', shortname: '' },
      { id: 25, fullname: 'Dissertation (S1-26_Tentative)', shortname: '' },
    ];
    expect(matchTaxilaCourse(s126, 'S1-26', ['DM ZG631'])).toMatchObject({
      kind: 'found',
      course: { id: 20 },
    });
    expect(matchTaxilaCourse(s126, 'S1-26', ['MTTM ZC261']).kind).toBe('none');
    expect(matchTaxilaCourse(s126, 'S1-26', ['SESAP ZC344']).kind).toBe('none');
    expect(matchTaxilaCourse(s126, 'S1-26', ['SESAP ZG628T']).kind).toBe('none');
  });
});

describe('the Course Handout File item', () => {
  it('only a File (resource) named "Course Handout" in General counts — never a folder', () => {
    const modules = [
      { id: 1, name: 'Course Handout', modname: 'folder', contextid: 11, contents: [] },
      { id: 2, name: 'Past Question Papers', modname: 'resource', contextid: 12, contents: [] },
      {
        id: 3,
        name: ' course handout ',
        modname: 'resource',
        contextid: 13,
        contents: [{ type: 'file', filename: 'Course Handout.pdf', filesize: 5 }],
      },
    ];
    expect(findHandoutItem([{ name: 'General', modules }])).toEqual({
      moduleId: 3,
      contextid: 13,
      files: [{ name: 'Course Handout.pdf', size: 5 }],
    });
    expect(findHandoutItem([{ name: 'General', modules: modules.slice(0, 2) }])).toBe(null);
    expect(findHandoutItem([{ name: 'Week 1', modules }])).toBe(null);
  });
});

describe('Check in Taxila (no upload)', () => {
  it('finds the course and the item holding the placeholder; nothing is uploaded', async () => {
    const r = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SS ZG653'] });
    expect(r).toMatchObject({
      status: 'ready',
      course: { id: 4101 },
      item: { contextid: 9101, files: [{ name: 'Course Handout.pdf', size: 900 }] },
      replaces: true,
      message: 'Ready to publish. It replaces the Course Handout.pdf there now.',
    });
    expect(fake.calls.map((c) => c.step)).toEqual(['search', 'contents']);
  });
  it('an empty item is ready too', async () => {
    item(4101).files = [];
    const r = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SS ZG653'] });
    expect(r).toMatchObject({ status: 'ready', replaces: false, message: 'Ready to publish.' });
  });
  it('a folder of the same name is ignored; the File item is used', async () => {
    const r = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SE ZG501'] });
    expect(r).toMatchObject({ status: 'ready', item: { contextid: 9102 } });
  });
  it('any other file in the item blocks publishing and is named', async () => {
    const r = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SE ZG503'] });
    expect(r).toMatchObject({
      status: 'other-files',
      others: ['Old handout 2025.pdf'],
      message:
        "Remove 'Old handout 2025.pdf' from Course Handout first, so students see the published handout.",
    });
    // Without the placeholder, and with a name that differs only in case: still blocked.
    item(4105).files = [
      { filename: 'course handout.pdf', size: 1 },
      { filename: 'Notes.pdf', size: 1 },
    ];
    const r2 = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SE ZG503'] });
    expect(r2).toMatchObject({
      status: 'other-files',
      message:
        "Remove 'course handout.pdf' and 'Notes.pdf' from Course Handout first, so students see the published handout.",
    });
  });
  it('v1.4.1: a chosen course is used as it is — no search, any name (e.g. a test course)', async () => {
    fake.courses.push({
      id: 4999,
      fullname: 'CIL_Exp',
      item: { name: 'Course Handout', contextid: 9999, files: [...PLACEHOLDER] },
    });
    const r = await checkInTaxila(client(), cfg, {
      semesterCode: 'S1-26',
      codes: ['XX ZG111'],
      chosen: { id: 4999, fullname: 'CIL_Exp', shortname: '' },
    });
    expect(r).toMatchObject({ status: 'ready', course: { id: 4999 }, item: { contextid: 9999 } });
    expect(fake.calls.map((c) => c.step)).toEqual(['contents']);
  });
  it('course not found', async () => {
    const r = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['XX ZG111'] });
    expect(r).toEqual({
      status: 'not-found',
      message: 'Course S1-26_XXZG111 not found in Taxila.',
    });
  });
  it('item missing (and no General section) tells the IC what to create', async () => {
    const r = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['CC ZG501'] });
    expect(r).toMatchObject({
      status: 'item-missing',
      message:
        "Create a File named 'Course Handout' in General with a placeholder named Course Handout.pdf, then check again.",
    });
    fake.courses[1]!.noGeneral = true;
    const r2 = await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SE ZG501'] });
    expect(r2.status).toBe('item-missing');
  });
});

describe('Publish', () => {
  it('uploads "Course Handout.pdf", replaces the placeholder, reads the item back', async () => {
    await publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF });
    expect(item(4101).files).toEqual([{ filename: 'Course Handout.pdf', size: PDF.length }]);
    expect(fake.calls.map((c) => c.step)).toEqual(['upload', 'move', 'contents']);
    const [up, mv] = fake.calls;
    expect(up).toMatchObject({ step: 'upload', method: 'POST' });
    expect(mv).toMatchObject({ step: 'move', method: 'POST' });
    expect(mv!.body).toContain('component=mod_resource');
    expect(mv!.body).toContain('filearea=content');
    expect(mv!.body).toContain('itemid=0');
    expect(mv!.body).toContain('contextid=9101');
  });

  it('publishing again replaces it — the item still holds exactly one file', async () => {
    await publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF });
    const bigger = Buffer.concat([PDF, Buffer.from(' v2 content')]);
    await publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: bigger });
    expect(item(4101).files).toEqual([{ filename: 'Course Handout.pdf', size: bigger.length }]);
  });

  it('a move that says "success" but changed nothing is not counted as published', async () => {
    fake.failures.move = 'move-no-effect';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF }),
    ).rejects.toMatchObject({
      step: 'verify',
      kind: 'not-confirmed',
      message: `Uploaded, but the Course Handout.pdf in Taxila isn't the new file (900 bytes, expected ${PDF.length}).`,
    });
    expect(item(4101).files).toEqual(PLACEHOLDER);
  });

  it('a file added in Taxila meanwhile makes it fail, naming the file', async () => {
    item(4101).files.push({ filename: 'Extra.pdf', size: 3 });
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF }),
    ).rejects.toMatchObject({
      step: 'verify',
      message:
        "Uploaded, but Course Handout also holds 'Extra.pdf', so students may open that instead. Remove it in Taxila, then publish again.",
    });
  });

  it('a move whose answer never comes, but which happened, counts as published — sent once', async () => {
    cfg.timeoutMs = SHORT;
    fake.failures.move = 'hang-after-move';
    await publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF });
    expect(fake.calls.filter((c) => c.step === 'move')).toHaveLength(1);
    expect(item(4101).files).toEqual([{ filename: 'Course Handout.pdf', size: PDF.length }]);
  });

  it('a move that times out without happening fails — and is not sent twice', async () => {
    cfg.timeoutMs = SHORT;
    fake.failures.move = 'hang';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'move', kind: 'move-failed' });
    expect(fake.calls.filter((c) => c.step === 'move')).toHaveLength(1);
    expect(item(4101).files).toEqual(PLACEHOLDER);
  });

  it('move answered "failed" → Move failed', async () => {
    fake.failures.move = 'move-not-success';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'move', kind: 'move-failed' });
  });

  it('a read-back that fails leaves it unconfirmed', async () => {
    const c = client();
    c.getHandoutItem = async () => {
      throw new TaxilaError('Taxila answered HTTP 502.', 'item', 'http');
    };
    await expect(
      publishFileToTaxila(c, { courseId: 4101, contextid: 9101, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'verify', kind: 'not-confirmed' });
  });

  it('upload failures are retried, then reported', async () => {
    fake.failures.upload = 'http500';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'upload', kind: 'http' });
    expect(fake.calls.filter((c) => c.step === 'upload')).toHaveLength(3);
    expect(fake.calls.some((c) => c.step === 'move')).toBe(false);
  });

  it('confirmPublished: exactly one Course Handout.pdf at the new size', () => {
    const at = (files: { name: string; size: number | null }[]) => ({
      moduleId: 1,
      contextid: 2,
      files,
    });
    expect(confirmPublished(at([{ name: 'Course Handout.pdf', size: 10 }]), 10)).toBeNull();
    expect(confirmPublished(at([]), 10)).toMatch(/isn't in the Course Handout item/);
    expect(confirmPublished(null, 10)).toMatch(/no longer in the course/);
    expect(confirmPublished(at([{ name: 'Course Handout.pdf', size: null }]), 10)).toMatch(
      /isn't the new file/,
    );
  });
});

describe('each step’s failure, in plain words', () => {
  it('search: timeout retried 3 times, then "didn’t answer"', async () => {
    cfg.timeoutMs = SHORT;
    fake.failures.search = 'hang';
    await expect(client().searchCourses('S1-26')).rejects.toMatchObject({
      step: 'search',
      kind: 'timeout',
      message: 'Taxila didn’t answer in 0 s.',
    });
    expect(fake.calls.filter((c) => c.step === 'search')).toHaveLength(3);
  });
  it('a Moodle exception is a refusal, not retried', async () => {
    fake.failures.contents = 'exception';
    await expect(client().getHandoutItem(4101)).rejects.toMatchObject({
      step: 'item',
      kind: 'refused',
      message: "Taxila refused: the HMP token can't call core_course_get_contents — ask IT.",
    });
    expect(fake.calls.filter((c) => c.step === 'contents')).toHaveLength(1);
  });
  it('a wrong token says so', async () => {
    await expect(
      createTaxilaClient({ ...cfg, token: 'wrong' }).searchCourses('S1-26'),
    ).rejects.toMatchObject({
      message: 'Taxila refused the HMP token — ask IT to check it.',
    });
  });
});

describe('the token never leaves the client', () => {
  it('appears only where Moodle needs it, never in any error', async () => {
    const errors: string[] = [];
    for (const step of ['search', 'contents', 'upload', 'move'] as const) {
      fake.failures = { [step]: 'http500' };
      try {
        await checkInTaxila(client(), cfg, { semesterCode: 'S1-26', codes: ['SS ZG653'] });
        await publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, pdf: PDF });
      } catch (err) {
        expect(err).toBeInstanceOf(TaxilaError);
        errors.push(String(err), JSON.stringify(err), (err as Error).stack ?? '');
      }
    }
    // An unreachable server's network error carries the URL — still redacted.
    await createTaxilaClient({ ...cfg, url: 'http://127.0.0.1:1/webservice/' })
      .upload(TAXILA_HANDOUT_FILE, PDF)
      .catch((err: Error) => errors.push(err.message, err.stack ?? ''));
    expect(errors.length).toBeGreaterThan(4);
    for (const e of errors) expect(e).not.toContain(TOKEN);
    expect(redact(`upload.php?token=${TOKEN}&x=1 and wstoken=abc`, TOKEN)).toBe(
      'upload.php?token=[token]&x=1 and wstoken=[token]',
    );
  });
});

describe('semester codes', () => {
  it('Sem-I 2026-27 → S1-26, Sem-II → S2-26, Summer left blank', () => {
    expect(defaultTaxilaSemesterCode('Sem-I 2026-27')).toBe('S1-26');
    expect(defaultTaxilaSemesterCode('Sem-II 2026-27')).toBe('S2-26');
    expect(defaultTaxilaSemesterCode('Semester 2 2025-26')).toBe('S2-25');
    expect(defaultTaxilaSemesterCode('Summer Term 2026')).toBe('');
  });
});
