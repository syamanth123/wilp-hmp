import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TaxilaError,
  checkInTaxila,
  createTaxilaClient,
  defaultTaxilaSemesterCode,
  matchTaxilaCourse,
  nextFreeFileName,
  publishFileToTaxila,
  redact,
  taxilaConfigFromEnv,
  taxilaCourseUrl,
  taxilaFileName,
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
    folderName: 'Course Handout',
    timeoutMs: 300,
    backoffMs: [0, 0],
  };
});
afterEach(() => fake.close());

const client = () => createTaxilaClient(cfg);
const name = taxilaFileName(['SS ZG653'], 'Sem-I 2026-27');

describe('settings', () => {
  it('Mode C needs both TAXILA_URL and TAXILA_TOKEN; the trailing slash is kept', () => {
    expect(taxilaConfigFromEnv({})).toBeNull();
    expect(taxilaConfigFromEnv({ TAXILA_URL: 'https://t/webservice/' })).toBeNull();
    expect(taxilaConfigFromEnv({ TAXILA_URL: 'https://t/webservice', TAXILA_TOKEN: 'x' })).toEqual({
      url: 'https://t/webservice/',
      token: 'x',
      folderName: 'Course Handout',
    });
    expect(taxilaCourseUrl({ url: 'https://taxila-aws.bits-pilani.ac.in/webservice/' }, 42)).toBe(
      'https://taxila-aws.bits-pilani.ac.in/course/view.php?id=42',
    );
  });
});

describe('course matching (IT’s rule)', () => {
  const courses = [
    { id: 1, fullname: 'S1-26_SSZG653 Software Architectures', shortname: '' },
    { id: 2, fullname: 's1-26_sszg6531 Something Else', shortname: '' },
    { id: 3, fullname: 'S1-26_MBAZC417/PDBAZC417 Business Statistics', shortname: '' },
    { id: 4, fullname: 'S2-26_SSZG653 Software Architectures', shortname: '' },
  ];
  it('one code: "<SEM>_<CODE without spaces>", case-insensitive, whole code only', () => {
    expect(matchTaxilaCourse(courses, 'S1-26', ['SS ZG653'])).toEqual({
      kind: 'found',
      course: courses[0],
    });
    expect(matchTaxilaCourse(courses, 'S1-26', ['SS ZG999'])).toEqual({ kind: 'none' });
  });
  it('merged course: matched by any of its codes', () => {
    expect(matchTaxilaCourse(courses, 'S1-26', ['PDBA ZC417', 'MBA ZC417'])).toMatchObject({
      kind: 'found',
      course: { id: 3 },
    });
  });
  it('several matches are never guessed', () => {
    const twice = [...courses, { id: 5, fullname: 'S1-26_SSZG653 (old copy)', shortname: '' }];
    expect(matchTaxilaCourse(twice, 'S1-26', ['SS ZG653'])).toMatchObject({ kind: 'ambiguous' });
  });
});

describe('Check in Taxila (no upload)', () => {
  it('finds the course and the folder; nothing is uploaded', async () => {
    const r = await checkInTaxila(client(), cfg, {
      semesterCode: 'S1-26',
      codes: ['SS ZG653'],
      fileName: name,
    });
    expect(r).toMatchObject({
      status: 'ready',
      course: { id: 4101 },
      folder: { contextid: 9101, files: [] },
    });
    expect(fake.calls.map((c) => c.step)).toEqual(['search', 'contents']);
  });
  it('already there', async () => {
    fake.courses[0]!.folder!.files.push({ filename: name, size: 10 });
    const r = await checkInTaxila(client(), cfg, {
      semesterCode: 'S1-26',
      codes: ['SS ZG653'],
      fileName: name,
    });
    expect(r).toMatchObject({ status: 'already-there', message: 'Already in Taxila.' });
  });
  it('course not found', async () => {
    const r = await checkInTaxila(client(), cfg, {
      semesterCode: 'S1-26',
      codes: ['XX ZG111'],
      fileName: name,
    });
    expect(r).toEqual({
      status: 'not-found',
      message: 'Course S1-26_XXZG111 not found in Taxila.',
    });
  });
  it('folder missing, and no General section', async () => {
    const r = await checkInTaxila(client(), cfg, {
      semesterCode: 'S1-26',
      codes: ['CC ZG501'],
      fileName: name,
    });
    expect(r).toMatchObject({
      status: 'folder-missing',
      message: "Folder 'Course Handout' not found in General.",
    });
    fake.courses[1]!.noGeneral = true;
    const r2 = await checkInTaxila(client(), cfg, {
      semesterCode: 'S1-26',
      codes: ['SE ZG501'],
      fileName: name,
    });
    expect(r2.status).toBe('folder-missing');
  });
});

describe('Publish', () => {
  it('upload then move: the file lands in the folder', async () => {
    await publishFileToTaxila(client(), {
      courseId: 4101,
      contextid: 9101,
      fileName: name,
      pdf: PDF,
    });
    expect(fake.courses[0]!.folder!.files).toEqual([{ filename: name, size: PDF.length }]);
    const [up, mv] = fake.calls;
    expect(up).toMatchObject({ step: 'upload', method: 'POST' });
    expect(mv).toMatchObject({ step: 'move', method: 'POST' });
    expect(mv!.body).toContain('component=mod_folder');
    expect(mv!.body).toContain('filearea=content');
    expect(mv!.body).toContain('itemid=0');
  });

  it('a move whose answer never comes, but which happened, counts as published — sent once', async () => {
    fake.failures.move = 'hang-after-move';
    await publishFileToTaxila(client(), {
      courseId: 4101,
      contextid: 9101,
      fileName: name,
      pdf: PDF,
    });
    expect(fake.calls.filter((c) => c.step === 'move')).toHaveLength(1);
    expect(fake.courses[0]!.folder!.files).toHaveLength(1);
  });

  it('a move that times out without happening fails — and is not sent twice', async () => {
    fake.failures.move = 'hang';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, fileName: name, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'move', kind: 'move-failed' });
    expect(fake.calls.filter((c) => c.step === 'move')).toHaveLength(1);
    expect(fake.courses[0]!.folder!.files).toHaveLength(0);
  });

  it('move answered "failed" → Move failed', async () => {
    fake.failures.move = 'move-not-success';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, fileName: name, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'move', kind: 'move-failed' });
  });

  it('upload failures are retried, then reported', async () => {
    fake.failures.upload = 'http500';
    await expect(
      publishFileToTaxila(client(), { courseId: 4101, contextid: 9101, fileName: name, pdf: PDF }),
    ).rejects.toMatchObject({ step: 'upload', kind: 'http' });
    expect(fake.calls.filter((c) => c.step === 'upload')).toHaveLength(3);
    expect(fake.calls.some((c) => c.step === 'move')).toBe(false);
  });
});

describe('each step’s failure, in plain words', () => {
  it('search: timeout retried 3 times, then "didn’t answer"', async () => {
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
    await expect(client().getFolder(4101)).rejects.toMatchObject({
      step: 'folder',
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
        await checkInTaxila(client(), cfg, {
          semesterCode: 'S1-26',
          codes: ['SS ZG653'],
          fileName: name,
        });
        await publishFileToTaxila(client(), {
          courseId: 4101,
          contextid: 9101,
          fileName: name,
          pdf: PDF,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(TaxilaError);
        errors.push(String(err), JSON.stringify(err), (err as Error).stack ?? '');
      }
    }
    // An unreachable server's network error carries the URL — still redacted.
    await createTaxilaClient({ ...cfg, url: 'http://127.0.0.1:1/webservice/' })
      .upload(name, PDF)
      .catch((err: Error) => errors.push(err.message, err.stack ?? ''));
    expect(errors.length).toBeGreaterThan(4);
    for (const e of errors) expect(e).not.toContain(TOKEN);
    expect(redact(`upload.php?token=${TOKEN}&x=1 and wstoken=abc`, TOKEN)).toBe(
      'upload.php?token=[token]&x=1 and wstoken=[token]',
    );
  });
});

describe('file names and semester codes', () => {
  it('codes joined with " _ ", never "/"; new versions " v2", " v3"', () => {
    expect(taxilaFileName(['SS ZG653'], 'Sem-I 2026-27')).toBe(
      'SS ZG653 Course Handout Sem-I 2026-27.pdf',
    );
    expect(taxilaFileName(['MBA ZC417', 'PDBA ZC417'], 'Sem-I 2026-27')).toBe(
      'MBA ZC417 _ PDBA ZC417 Course Handout Sem-I 2026-27.pdf',
    );
    expect(taxilaFileName(['A/B ZC1'], 'X/Y', 2)).toBe('A-B ZC1 Course Handout X-Y v2.pdf');
    expect(
      nextFreeFileName(['SS ZG653'], 'Sem-I 2026-27', [name, name.replace('.pdf', ' v2.pdf')]),
    ).toBe('SS ZG653 Course Handout Sem-I 2026-27 v3.pdf');
  });
  it('Sem-I 2026-27 → S1-26, Sem-II → S2-26, Summer left blank', () => {
    expect(defaultTaxilaSemesterCode('Sem-I 2026-27')).toBe('S1-26');
    expect(defaultTaxilaSemesterCode('Sem-II 2026-27')).toBe('S2-26');
    expect(defaultTaxilaSemesterCode('Semester 2 2025-26')).toBe('S2-25');
    expect(defaultTaxilaSemesterCode('Summer Term 2026')).toBe('');
  });
});
