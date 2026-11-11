import { describe, expect, it } from 'vitest';
import { RoleName } from '@hmp/db';
import { renderEmail, type EmailContent } from '../layout';
import {
  CATALOGUE,
  CATALOGUE_BY_KEY,
  fill,
  unknownPlaceholders,
  wordingFor,
  type WordingEdits,
} from '../catalogue';
import {
  NO_EXTRA,
  transitionChoice,
  transitionEmail,
  type EventExtra,
  type MailContext,
  type MailEvent,
} from '../events';
import {
  bulkEmail,
  commentEmail,
  digestEmail,
  digestItemOf,
  reminderEmail,
  roleChangedEmail,
  welcomeEmail,
} from '../other';
import { detailRows, peopleRows, slotText, type RequestFacts } from '../request-facts';

// v1.4.3 (§G, §7) — every email: the required parts, a plain-text version, links to the reader's own page,
// escaping, no gaps for missing data, and no password in the welcome email.

const NOW = new Date('2026-11-20T06:00:00Z');
const DAY = 86_400_000;

function facts(over: Partial<RequestFacts> = {}): RequestFacts {
  const due = new Date(NOW.getTime() + 3 * DAY);
  return {
    id: 'req1',
    refNo: 'HMP-2026-0101',
    status: 'REWORK_REQUESTED',
    statusText: 'Sent back for changes',
    course: { code: 'SS ZG653', title: 'Software Testing' },
    semester: {
      name: 'Sem-I 2026-27',
      startDate: new Date('2026-12-20T00:00:00Z'),
      examDate: new Date('2027-03-01T00:00:00Z'),
    },
    programme: { code: 'MTECH-SE', name: 'M.Tech Software Engineering' },
    department: 'CSIS',
    version: { no: 2, note: 'Updated the books', at: NOW },
    slot: 'Slot 3 · Sunday forenoon',
    people: {
      ic: { id: 'ic', name: 'IC Officer', email: 'ic@x.test', note: null },
      hog: { id: 'hog', name: 'Dr Hog', email: 'hog@x.test', note: null },
      pc: { id: 'pc', name: 'Dr Pc', email: 'pc@x.test', note: null },
      faculty: [
        { id: 'f2', name: 'Dr Second', email: 'f2@x.test', note: null, lead: false },
        {
          id: 'f1',
          name: 'Dr Lead',
          email: 'f1@x.test',
          note: 'away until 25 Nov 2026',
          lead: true,
        },
      ].sort((a, b) => Number(b.lead) - Number(a.lead)),
      sme: { id: 'sme', name: 'Dr Sme', email: 'sme@x.test', note: null },
    },
    deadlines: [
      { stage: 'DRAFT', label: 'Faculty draft', dueAt: due, source: 'rule', state: 'current' },
      { stage: 'SME_REVIEW', label: 'SME review', dueAt: due, source: 'rule', state: 'later' },
    ],
    current: {
      stage: 'DRAFT',
      label: 'Faculty draft',
      dueAt: due,
      source: 'rule',
      state: 'current',
    },
    timeline: [
      {
        id: 't1',
        at: NOW,
        sentence: 'Allocated faculty',
        status: null,
        detail: null,
        actorName: 'Dr Hog',
      },
    ],
    ...over,
  };
}

const ctx = (edits?: WordingEdits): MailContext => ({
  actorName: 'Dr Pc',
  now: NOW,
  url: (p) => `https://hmp.example.test${p}`,
  footer: { help: 'IC desk', replyTo: null },
  logoUrl: 'https://hmp.example.test/email-logo.png',
  edits: edits ?? null,
});

const faculty = { id: 'f1', name: 'Dr Lead', email: 'f1@x.test', role: RoleName.FACULTY };
const sentBack: EventExtra = {
  ...NO_EXTRA,
  decision: {
    by: 'Dr Pc',
    stage: 'PC_REVIEW',
    at: NOW,
    comments: '1. Fix the evaluation weights.\n2. Use the 2021 edition of R2.',
  },
};

function mustHaveParts(c: EmailContent, html: string, text: string) {
  expect(c.subject).toContain('SS ZG653');
  expect(c.summary.length).toBeGreaterThan(10);
  expect(c.action.text.length).toBeGreaterThan(5);
  expect(c.button?.url).toMatch(/^https:\/\/hmp\.example\.test\//);
  expect(html).toContain('Handout details');
  expect(html).toContain('People');
  expect(html).toContain('You get this because');
  expect(text).toContain('HANDOUT DETAILS');
  expect(text).toContain('PEOPLE');
  expect(text).toContain(c.button!.url);
  // Nothing left unfilled, nothing printed raw.
  expect(html).not.toMatch(/\{\{|undefined|null|\[object/);
  expect(text).not.toMatch(/\{\{|undefined|\[object/);
}

describe('the layout', () => {
  it('escapes everything a person typed', () => {
    const r = renderEmail({
      subject: 'x <b>',
      summary: '<script>alert(1)</script>',
      action: { needed: false, text: 'a & b' },
      happened: { title: 'The comment', quotes: [{ by: 'Dr "X"', text: '<img src=x onerror=1>' }] },
      footer: { why: 'w', settingsUrl: 'https://h/settings' },
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('a &amp; b');
    expect(r.subject).toBe('[HMP] x <b>');
  });

  it('leaves out empty parts and says "Please do not reply" without a reply-to', () => {
    const r = renderEmail({
      subject: 's',
      summary: 'Only a summary.',
      action: { needed: false, text: 'Nothing to do.' },
      details: [],
      people: [],
      timeline: [],
      happened: { title: 'What happened', rows: [], quotes: [], bullets: [] },
      footer: { why: 'w', settingsUrl: 'https://h/settings' },
    });
    expect(r.html).not.toContain('Handout details');
    expect(r.html).not.toContain('What happened');
    expect(r.html).not.toContain('Recent steps');
    expect(r.text).toContain('Please do not reply');
    expect(r.html).toContain('No action needed — for your information');
  });

  it('shows the due line red when overdue', () => {
    const r = renderEmail({
      subject: 's',
      summary: 'x',
      action: {
        needed: true,
        text: 'Do it.',
        due: { day: '01 Dec 2026', words: '2 days overdue', tone: 'overdue' },
      },
      footer: { why: 'w', settingsUrl: 'https://h/settings', replyTo: 'ic@x.test' },
    });
    expect(r.html).toContain('#b42318');
    expect(r.text).toContain('By 01 Dec 2026 (2 days overdue)');
    expect(r.text).toContain('Replies to this email go to ic@x.test.');
  });
});

describe('details, people and slots', () => {
  it('the details box leaves out what the request has not got', () => {
    const rows = detailRows(
      facts({
        department: null,
        slot: null,
        version: null,
        semester: { ...facts().semester, examDate: null },
      }),
    ).map((r) => r.label);
    expect(rows).toEqual(['Course', 'Semester', 'Programme', 'HMP reference', 'Status now']);
  });

  it('the Instructor-in-Charge comes first, with the away note', () => {
    const p = peopleRows(facts()).filter((x) => x.role === 'Faculty');
    expect(p[0]!.name).toBe('Dr Lead');
    expect(p[0]!.note).toBe('Instructor-in-Charge · away until 25 Nov 2026');
  });

  it('Dibba slots read in words, once each', () => {
    expect(
      slotText([
        { slotNo: 3, slotDay: 'SUN', slotSession: 'FN' },
        { slotNo: 3, slotDay: 'SUN', slotSession: 'FN' },
        { slotNo: 0, slotDay: null, slotSession: null },
      ]),
    ).toBe('Slot 3 · Sunday forenoon');
    expect(slotText([{ slotNo: 0, slotDay: null, slotSession: null }])).toBeNull();
  });
});

describe('workflow emails', () => {
  it('sent back: the reviewer’s full comments, the due date, the faculty’s own page', () => {
    const c = transitionEmail('REVIEW_REWORK', facts(), faculty, sentBack, ctx())!;
    const r = renderEmail(c);
    mustHaveParts(c, r.html, r.text);
    expect(r.subject).toBe(
      '[HMP] Changes needed: SS ZG653 Software Testing (Sem-I 2026-27) — due 23 Nov 2026',
    );
    expect(c.action.needed).toBe(true);
    expect(c.action.due?.words).toBe('Faculty draft · 3 days left');
    expect(r.text).toContain('2. Use the 2021 edition of R2.');
    expect(r.html).toContain('Fix the evaluation weights.<br>2. Use the 2021 edition');
    expect(c.button!.url).toBe('https://hmp.example.test/faculty/assignments/req1');
  });

  it('every step, for every reader role, gives a complete email (or none) without loose placeholders', () => {
    const events: MailEvent[] = [
      'REQUEST_INITIATED',
      'FACULTY_ALLOCATED',
      'ASSIGNED',
      'ALLOCATION_REJECTED',
      'SUBMITTED',
      'SME_REVIEW_REQUESTED',
      'SME_APPROVED',
      'SME_REVERTED',
      'REVIEW_REWORK',
      'REVIEW_APPROVED',
      'FINAL_APPROVED',
      'FINAL_REJECTED',
      'PUBLISHED',
      'ARCHIVED',
    ];
    const roles = [
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
      RoleName.SME,
      RoleName.INSTRUCTION_CELL,
    ];
    let n = 0;
    for (const e of events)
      for (const role of roles) {
        const c = transitionEmail(e, facts(), { ...faculty, role }, sentBack, ctx());
        if (!c) continue;
        n += 1;
        const r = renderEmail(c);
        mustHaveParts(c, r.html, r.text);
        // Info emails carry no due date; action emails do.
        expect(!!c.action.due).toBe(c.action.needed);
      }
    expect(n).toBeGreaterThan(40);
  });

  it('first version / what changed', () => {
    const first = transitionEmail(
      'SME_REVIEW_REQUESTED',
      facts(),
      { ...faculty, role: RoleName.SME },
      { ...NO_EXTRA, changes: { first: true, lines: [] } },
      ctx(),
    )!;
    expect(first.happened?.bullets).toEqual(['This is the first version sent for review.']);
    expect(first.happened?.rows).toEqual([
      { label: 'Version', value: '2' },
      { label: 'Faculty’s note', value: 'Updated the books' },
    ]);
    const again = transitionEmail(
      'SME_APPROVED',
      facts(),
      { ...faculty, role: RoleName.PROGRAMME_COMMITTEE },
      { ...NO_EXTRA, changes: { first: false, lines: ['Evaluation: 2 changed, 1 added'] } },
      ctx(),
    )!;
    expect(again.happened?.bullets).toEqual(['Evaluation: 2 changed, 1 added']);
  });

  it('published: the Taxila course link, the file and the PDF link', () => {
    const c = transitionEmail(
      'PUBLISHED',
      facts(),
      faculty,
      {
        ...NO_EXTRA,
        published: {
          course: 'Software Testing (S1-26_SSZG653)',
          url: 'https://taxila.example.test/course/view.php?id=42',
          fileName: 'Course Handout.pdf',
          at: NOW,
        },
      },
      ctx(),
    )!;
    const rows = c.happened!.rows!;
    expect(rows.find((r) => r.label === 'Taxila course')?.href).toBe(
      'https://taxila.example.test/course/view.php?id=42',
    );
    expect(rows.find((r) => r.label === 'File')?.value).toBe('Course Handout.pdf');
    expect(rows.find((r) => r.label === 'PDF')?.href).toBe(
      'https://hmp.example.test/api/handouts/req1/export/pdf',
    );
    expect(c.action.needed).toBe(false);
  });

  it('final approval: the IC is asked to publish — unless auto-publish is on', () => {
    expect(
      transitionChoice('FINAL_APPROVED', RoleName.INSTRUCTION_CELL, facts(), NO_EXTRA, 'x')?.key,
    ).toBe('approved:IC');
    expect(
      transitionChoice(
        'FINAL_APPROVED',
        RoleName.INSTRUCTION_CELL,
        facts(),
        { ...NO_EXTRA, autoPublish: true },
        'x',
      )?.key,
    ).toBe('approved:INFO');
  });

  it('a back-up’s copy says whose back-up they are', () => {
    const c = transitionEmail(
      'REQUEST_INITIATED',
      facts(),
      { id: 'b', name: 'Dr Backup', email: 'b@x.test', role: RoleName.HOG, backupFor: 'Dr Hog' },
      NO_EXTRA,
      ctx(),
    )!;
    expect(c.summary).toContain('You get this as Dr Hog’s back-up while they are away.');
    expect(c.footer.why).toContain('Dr Hog’s back-up');
  });
});

describe('the other emails', () => {
  it('reminder and escalation say who has it, who was told, and what waits on it', () => {
    const overdue = facts({
      current: {
        stage: 'DRAFT',
        label: 'Faculty draft',
        dueAt: new Date(NOW.getTime() - 4 * DAY),
        source: 'manual',
        reason: 'Late start',
        setByName: 'IC Officer',
        state: 'current',
      },
    });
    const c = reminderEmail(
      overdue,
      { id: 'hog', name: 'Dr Hog', email: 'hog@x.test', role: RoleName.HOG },
      { copy: true, holders: ['Dr Lead'], told: ['Dr Lead'] },
      ctx(),
    )!;
    const r = renderEmail(c);
    expect(r.subject).toBe(
      '[HMP] Overdue: Dr Lead — Faculty draft, SS ZG653 Software Testing (Sem-I 2026-27), 4 days overdue',
    );
    expect(r.text).toContain('Already told: Dr Lead');
    expect(r.text).toContain('Waiting on this: SME review');
    expect(r.text).toContain('date set by IC Officer: “Late start”');
    expect(c.action.due?.tone).toBe('overdue');
  });

  it('comment and reply: the text in full, and the comment it answers', () => {
    const c = commentEmail(
      facts(),
      faculty,
      {
        mention: false,
        author: 'Dr Pc',
        at: NOW,
        text: 'Agreed, see my note.',
        parent: { author: 'Dr Lead', at: NOW, text: 'Is 30% fine?' },
      },
      ctx(),
    );
    expect(c.happened!.quotes!.map((q) => q.text)).toEqual([
      'Is 30% fine?',
      'Agreed, see my note.',
    ]);
    expect(c.button!.url).toBe('https://hmp.example.test/faculty/assignments/req1#comments');
  });

  it('the welcome email never contains a password, with or without BITS sign-in', () => {
    for (const sso of [true, false]) {
      const r = renderEmail(
        welcomeEmail(
          { name: 'Dr New', email: 'new@x.test', roles: [RoleName.FACULTY], department: 'CSIS' },
          { addedBy: 'IC Officer', sso },
          ctx(),
        ),
      );
      expect(r.text).not.toMatch(/password\s*[:=]/i);
      expect(r.text).toContain('new@x.test');
      expect(r.text).toContain(
        sso ? 'Sign in with BITS' : 'will give you your password separately',
      );
      expect(r.html).toContain('https://hmp.example.test/login');
    }
  });

  it('roles changed: old → new, and what appears in the menu', () => {
    const c = roleChangedEmail(
      { name: 'Dr A' },
      {
        by: 'IC Officer',
        undo: false,
        before: { roles: [RoleName.FACULTY], department: 'CSIS' },
        after: { roles: [RoleName.FACULTY, RoleName.PROGRAMME_COMMITTEE], department: 'EEE' },
      },
      ctx(),
    );
    const t = renderEmail(c).text;
    expect(t).toContain('Department: CSIS → EEE');
    expect(t).toContain('New: allocations to confirm and handouts to review.');
  });

  it('digest and bulk: action items first, soonest due first', () => {
    const late = transitionEmail(
      'REQUEST_INITIATED',
      facts(),
      { ...faculty, role: RoleName.HOG },
      NO_EXTRA,
      ctx(),
    )!;
    const items = [
      { ...digestItemOf(late, new Date(NOW.getTime() + 9 * DAY)), title: 'later' },
      { ...digestItemOf(late, new Date(NOW.getTime() + 1 * DAY)), title: 'sooner' },
      { action: false, title: 'fyi', url: 'https://hmp.example.test/', lines: ['x'] },
    ];
    const d = digestEmail({ name: 'Dr Hog' }, items, ctx());
    expect(d.groups![0]!.items.map((i) => i.title)).toEqual(['sooner', 'later']);
    expect(d.groups![1]!.items.map((i) => i.title)).toEqual(['fyi']);
    expect(d.subject).toBe('Your daily summary: 2 need you, 3 updates');
    const b = bulkEmail({ name: 'Dr Hog' }, { actor: 'IC Officer', items }, ctx());
    expect(b.subject).toBe('Action needed: 2 requests from IC Officer');
    expect(renderEmail(b).text).toContain('ACTION NEEDED (2)');
  });
});

describe('editable wording (H29)', () => {
  it('every built-in wording only uses its own placeholders', () => {
    for (const c of CATALOGUE)
      for (const t of [c.subject, c.summary, c.action])
        expect(unknownPlaceholders(c, t), `${c.key}: ${t}`).toEqual([]);
  });

  it('an unknown or single-brace placeholder is refused', () => {
    const e = CATALOGUE_BY_KEY.get('sent-back:FACULTY')!;
    expect(unknownPlaceholders(e, 'Hi {{nmae}}')).toEqual(['nmae']);
    expect(unknownPlaceholders(e, 'Hi {name}')).toEqual(['{name}']);
    expect(unknownPlaceholders(e, 'Hi {{name}} — {{reviewer}}')).toEqual([]);
  });

  it('an edit applies field by field; empty fields keep the built-in wording', () => {
    const edits: WordingEdits = new Map([
      [
        'sent-back:FACULTY',
        {
          subject: 'Please revise: {{courseCode}}',
          summary: '',
          action: '',
          editedAt: null,
          editedBy: null,
        },
      ],
    ]);
    const w = wordingFor(
      'sent-back:FACULTY',
      { courseCode: 'SS ZG653', reviewer: 'Dr Pc', course: 'SS ZG653 T' },
      edits,
    );
    expect(w.subject).toBe('Please revise: SS ZG653');
    expect(w.summary).toBe('Dr Pc sent the handout for SS ZG653 T back to you for changes.');
    const c = transitionEmail('REVIEW_REWORK', facts(), faculty, sentBack, ctx(edits))!;
    expect(c.subject).toBe('Please revise: SS ZG653 — due 23 Nov 2026');
  });

  it('a placeholder the email has no value for becomes empty, never "{{x}}"', () => {
    expect(fill('A {{missing}} B', {})).toBe('A B');
  });
});
