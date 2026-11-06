import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * A stand-in for Taxila (Moodle) that speaks the five calls HMP uses (taxila-moodle.ts) — so tests
 * and CI never touch the real Taxila. Responses have the shapes IT's QPM document shows. Any step
 * can be told to fail; every request is recorded (with its raw URL, so tests can prove the token
 * appears only where Moodle needs it).
 */

export interface FakeFile {
  filename: string;
  size: number;
}

export interface FakeCourse {
  id: number;
  fullname: string;
  shortname?: string;
  /** General's "Course Handout" File item (mod_resource). Omit it to model a course without one. */
  item?: { name: string; contextid: number; files: FakeFile[] };
  /** Other modules in General — e.g. an old "Course Handout" folder HMP must ignore. */
  extraModules?: { name: string; modname: string; contextid: number; files?: FakeFile[] }[];
  /** No "General" section at all. */
  noGeneral?: boolean;
}

export type FakeStep = 'search' | 'contents' | 'upload' | 'move';
export type FakeFailure =
  | 'http500'
  | 'hang' // never answers (client timeout)
  | 'exception' // Moodle-style {exception, errorcode, message} with HTTP 200
  | 'move-not-success' // move answers {status: "failed"}
  | 'move-no-effect' // move answers "success" but places nothing (the read-back must catch it)
  | 'hang-after-move'; // performs the move, then never answers

export interface FakeMoodle {
  /** "http://127.0.0.1:<port>/webservice/" — what TAXILA_URL would be. */
  url: string;
  port: number;
  token: string;
  courses: FakeCourse[];
  calls: { step: FakeStep | 'other'; method: string; rawUrl: string; body?: string }[];
  failures: Partial<Record<FakeStep, FakeFailure>>;
  /** Adds a delay (ms) to every answer — to show a bulk run in progress. */
  delayMs: number;
  close(): Promise<void>;
}

const asContent = (f: FakeFile) => ({
  type: 'file',
  filename: f.filename,
  filepath: '/',
  filesize: f.size,
  sortorder: 0,
});

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** The uploaded file's name and size from a multipart body (field `file_1`). */
function parseUpload(
  body: Buffer,
  contentType: string,
): { field: string; filename: string; size: number } | null {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1]?.replace(/^"|"$/g, '');
  if (!boundary) return null;
  const text = body.toString('latin1');
  for (const part of text.split(`--${boundary}`)) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const field = /name="([^"]+)"/.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/.exec(headers)?.[1];
    if (!field || filename === undefined) continue;
    const content = part.slice(headerEnd + 4).replace(/\r\n$/, '');
    return {
      field,
      filename: Buffer.from(filename, 'latin1').toString('utf8'),
      size: Buffer.byteLength(content, 'latin1'),
    };
  }
  return null;
}

export async function startFakeMoodle(opts: {
  token: string;
  courses: FakeCourse[];
  port?: number;
}): Promise<FakeMoodle> {
  const drafts = new Map<number, { filename: string; size: number }>();
  let nextItem = 1000;

  const fake: FakeMoodle = {
    url: '',
    port: 0,
    token: opts.token,
    courses: opts.courses,
    calls: [],
    failures: {},
    delayMs: 0,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };

  const fail = (res: ServerResponse, step: FakeStep): boolean => {
    const f = fake.failures[step];
    if (!f || f === 'hang-after-move' || f === 'move-not-success' || f === 'move-no-effect')
      return false;
    if (f === 'hang') return true; // leave the request open
    if (f === 'http500') json(res, { error: 'boom' }, 500);
    else
      json(res, {
        exception: 'webservice_access_exception',
        errorcode: 'accessexception',
        message: 'Access control exception',
      });
    return true;
  };

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
    if (fake.delayMs) await new Promise((r) => setTimeout(r, fake.delayMs));

    if (u.pathname === '/webservice/upload.php') {
      fake.calls.push({ step: 'upload', method: req.method ?? '', rawUrl: req.url ?? '' });
      if (u.searchParams.get('token') !== fake.token)
        return json(res, { error: 'Invalid token - token not found', errorcode: 'invalidtoken' });
      if (fail(res, 'upload')) return;
      const file = parseUpload(body, String(req.headers['content-type'] ?? ''));
      if (!file || file.field !== 'file_1')
        return json(res, { error: 'No file', errorcode: 'nofile' });
      const itemid = nextItem++;
      drafts.set(itemid, { filename: file.filename, size: file.size });
      return json(res, [
        {
          component: 'user',
          contextid: 5,
          userid: '2',
          filearea: 'draft',
          filename: file.filename,
          filepath: '/',
          itemid,
          license: 'unknown',
          author: 'HMP',
          source: '',
        },
      ]);
    }

    if (u.pathname === '/webservice/rest/server.php') {
      const params =
        req.method === 'POST' ? new URLSearchParams(body.toString('utf8')) : u.searchParams;
      const fn = params.get('wsfunction');
      const step: FakeStep | 'other' =
        fn === 'core_course_search_courses'
          ? 'search'
          : fn === 'core_course_get_contents'
            ? 'contents'
            : fn === 'local_move_file_from_draft'
              ? 'move'
              : 'other';
      fake.calls.push({
        step,
        method: req.method ?? '',
        rawUrl: req.url ?? '',
        body: req.method === 'POST' ? body.toString('utf8') : undefined,
      });
      if (params.get('wstoken') !== fake.token)
        return json(res, {
          exception: 'moodle_exception',
          errorcode: 'invalidtoken',
          message: 'Invalid token - token not found',
        });
      if (step !== 'other' && fail(res, step)) return;

      if (step === 'search') {
        const q = (params.get('criteriavalue') ?? '').toLowerCase();
        const found = fake.courses.filter((c) => c.fullname.toLowerCase().includes(q));
        return json(res, {
          total: found.length,
          courses: found.map((c) => ({
            id: c.id,
            fullname: c.fullname,
            shortname: c.shortname ?? c.fullname.slice(0, 20),
          })),
          warnings: [],
        });
      }
      if (step === 'contents') {
        const c = fake.courses.find((x) => x.id === Number(params.get('courseid')));
        if (!c)
          return json(res, {
            exception: 'dml_missing_record_exception',
            errorcode: 'invalidrecord',
            message: 'Can not find data record in database table course.',
          });
        const sections = c.noGeneral
          ? [{ id: 2, name: 'Week 1', modules: [] }]
          : [
              {
                id: 1,
                name: 'General',
                modules: [
                  { id: 7, name: 'Announcements', modname: 'forum', contextid: 111 },
                  ...(c.extraModules ?? []).map((m, i) => ({
                    id: 20 + i,
                    name: m.name,
                    modname: m.modname,
                    contextid: m.contextid,
                    contents: (m.files ?? []).map(asContent),
                  })),
                  ...(c.item
                    ? [
                        {
                          id: 9,
                          name: c.item.name,
                          modname: 'resource',
                          contextid: c.item.contextid,
                          contents: c.item.files.map(asContent),
                        },
                      ]
                    : []),
                ],
              },
              { id: 2, name: 'Week 1', modules: [] },
            ];
        return json(res, sections);
      }
      if (step === 'move') {
        if (fake.failures.move === 'move-not-success') return json(res, { status: 'failed' });
        const draft = drafts.get(Number(params.get('draftitemid')));
        const course = fake.courses.find(
          (c) => c.item?.contextid === Number(params.get('contextid')),
        );
        if (
          !draft ||
          !course?.item ||
          params.get('component') !== 'mod_resource' ||
          params.get('filearea') !== 'content' ||
          params.get('itemid') !== '0'
        )
          return json(res, { status: 'failed' });
        drafts.delete(Number(params.get('draftitemid')));
        if (fake.failures.move !== 'move-no-effect') {
          // As Taxila does: a file with the same name is replaced, any other name is added beside.
          const files = course.item.files.filter((f) => f.filename !== draft.filename);
          course.item.files = [...files, { filename: draft.filename, size: draft.size }];
        }
        if (fake.failures.move === 'hang-after-move') return; // moved, but the answer never comes
        return json(res, {
          status: 'success',
          message: 'Files moved and replaced if existed.',
          files: [draft.filename],
        });
      }
      return json(res, {
        exception: 'dml_missing_record_exception',
        errorcode: 'invalidrecord',
        message: 'Function not found',
      });
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  fake.port = (server.address() as { port: number }).port;
  fake.url = `http://127.0.0.1:${fake.port}/webservice/`;
  // Open "hang" requests must not keep the process alive after close().
  server.on('connection', (s) => s.unref());
  return fake;
}

/**
 * A small Taxila for demos and tests (S1-26): Course Handout items holding the placeholder, one
 * course without the item, one whose item still holds an old file beside the placeholder.
 */
export function sampleTaxilaCourses(): FakeCourse[] {
  const placeholder = (): FakeFile[] => [{ filename: 'Course Handout.pdf', size: 900 }];
  // Real Taxila name shapes (taxila-discover.log, 5 Nov 2026).
  return [
    {
      id: 4101,
      fullname: 'Software Architectures (S1-26_SSZG653)',
      item: { name: 'Course Handout', contextid: 9101, files: placeholder() },
    },
    {
      id: 4102,
      fullname: 'Software Engineering (S1-26_SEZG501)',
      item: { name: 'Course Handout', contextid: 9102, files: placeholder() },
      // An old-style folder of the same name — HMP never publishes into it.
      extraModules: [{ name: 'Course Handout', modname: 'folder', contextid: 8102 }],
    },
    { id: 4103, fullname: 'Introduction to Parallel and Distributed Programming (S1-26_CCZG501)' },
    {
      id: 4104,
      fullname:
        'Quantitative Methods | Business Statistics (Merged - MBAZC417/PDBAZC417/PDFTZC417)(S1-26)',
      item: { name: 'Course Handout', contextid: 9104, files: placeholder() },
    },
    {
      id: 4105,
      fullname: 'Software Testing (S1-26_SEZG503)',
      item: {
        name: 'Course Handout',
        contextid: 9105,
        files: [...placeholder(), { filename: 'Old handout 2025.pdf', size: 700 }],
      },
    },
  ];
}
