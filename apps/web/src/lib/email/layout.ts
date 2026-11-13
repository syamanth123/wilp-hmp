/**
 * v1.4.3 (§G) — the one layout every HMP email uses: a BITS header, a one-line summary, "what you need to
 * do" with the due date, a big button, what happened, the handout's details, the people, a short timeline
 * and a footer saying why you got it. Pure (no DB): callers fill `EmailContent`; this returns the subject,
 * the HTML and the plain-text version.
 *
 * Mail clients are old-fashioned: tables and inline styles only, no web fonts, no CSS classes. Every value
 * is escaped here, so callers pass plain text. Empty parts are left out (no blank boxes or "undefined").
 */

export interface EmailRow {
  label: string;
  value: string;
  /** Makes the value a link (absolute URL). */
  href?: string;
}

export interface EmailPerson {
  role: string;
  name: string;
  email: string;
  /** e.g. "Instructor-in-Charge", "away until 20 Nov 2026 — back-up: Dr C". */
  note?: string | null;
}

export interface EmailQuote {
  by: string;
  when?: string | null;
  text: string;
}

export interface EmailContent {
  /** Subject without the "[HMP]" prefix. */
  subject: string;
  greetingName?: string | null;
  /** One line in plain words: "Dr A has submitted the handout for SS ZG653 for your review." */
  summary: string;
  action: {
    /** false = "No action needed — for your information". */
    needed: boolean;
    text: string;
    due?: { day: string; words: string; tone: 'overdue' | 'soon' | 'ok' } | null;
  };
  button?: { label: string; url: string } | null;
  happened?: {
    title: string;
    rows?: EmailRow[];
    quotes?: EmailQuote[];
    bullets?: string[];
  } | null;
  /** The daily digest: "Action needed" / "For information", one compact block per item. */
  groups?: {
    title: string;
    /** A line under the heading (the weekly summary: the department’s numbers). */
    note?: string;
    /** false: no “(3)” count after the heading. */
    count?: boolean;
    items: { title: string; url: string; lines: string[] }[];
  }[];
  details?: EmailRow[];
  people?: EmailPerson[];
  timeline?: { day: string; text: string }[];
  footer: {
    /** "You get this because you are the faculty on this handout." */
    why: string;
    settingsUrl: string;
    help?: string | null;
    /** The IC mailbox, when replies go there; otherwise "Please do not reply". */
    replyTo?: string | null;
  };
  /** Absolute URL of the small header logo; left out when the site address isn't known. */
  logoUrl?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const NAVY = '#1e2a5c';
const GOLD = '#f5a623';
const INK = '#14161c';
const MUTED = '#5b6070';
const LINE = '#e6e6e0';
const TINT = '#eef2fb';
const TONE: Record<'overdue' | 'soon' | 'ok', string> = {
  overdue: '#b42318',
  soon: '#b54708',
  ok: '#1e2a5c',
};
const FONT = 'font-family:Segoe UI,Arial,Helvetica,sans-serif;';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Line breaks in a person's text (comments, reasons) are kept. */
const multiline = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

const has = <T>(xs: T[] | null | undefined): xs is T[] => Array.isArray(xs) && xs.length > 0;

function sectionTitle(t: string): string {
  return `<tr><td style="${FONT}padding:20px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};font-weight:600">${esc(t)}</td></tr>`;
}

function rowsTable(rows: EmailRow[]): string {
  return (
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:6px;border-collapse:separate">` +
    rows
      .map(
        (r, i) =>
          `<tr><td style="${FONT}padding:7px 12px;font-size:13px;color:${MUTED};width:34%;vertical-align:top;${i ? `border-top:1px solid ${LINE};` : ''}">${esc(r.label)}</td>` +
          `<td style="${FONT}padding:7px 12px;font-size:13px;color:${INK};vertical-align:top;${i ? `border-top:1px solid ${LINE};` : ''}">${
            r.href
              ? `<a href="${esc(r.href)}" style="color:${NAVY}">${esc(r.value)}</a>`
              : multiline(r.value)
          }</td></tr>`,
      )
      .join('') +
    `</table></td></tr>`
  );
}

export function renderEmail(c: EmailContent): RenderedEmail {
  const subject = `[HMP] ${c.subject}`;
  const h: string[] = [];
  const t: string[] = [];

  // ---- header
  h.push(
    `<tr><td style="background:${NAVY};padding:14px 24px;border-bottom:4px solid ${GOLD}">` +
      `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
      (c.logoUrl
        ? `<td style="padding-right:12px;vertical-align:middle"><img src="${esc(c.logoUrl)}" width="88" height="44" alt="BITS Pilani" style="display:block;border:0"></td>`
        : '') +
      `<td style="${FONT}vertical-align:middle;color:#ffffff"><div style="font-size:16px;font-weight:600">Handout Management Portal</div>` +
      `<div style="font-size:12px;color:#c9d2ee">BITS Pilani · Work Integrated Learning Programmes</div></td>` +
      `</tr></table></td></tr>`,
  );
  t.push('HMP · Handout Management Portal · BITS Pilani WILP', '');

  // ---- body
  const b: string[] = [];
  if (c.greetingName) {
    b.push(
      `<tr><td style="${FONT}font-size:14px;color:${INK};padding-bottom:6px">Dear ${esc(c.greetingName)},</td></tr>`,
    );
    t.push(`Dear ${c.greetingName},`, '');
  }
  b.push(
    `<tr><td style="${FONT}font-size:16px;line-height:1.45;color:${INK};font-weight:600">${multiline(c.summary)}</td></tr>`,
  );
  t.push(c.summary, '');

  // what you need to do
  const due = c.action.due;
  b.push(
    `<tr><td style="padding-top:14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.action.needed ? TINT : '#f6f6f3'};border-left:4px solid ${c.action.needed ? NAVY : '#b9bcc6'}">` +
      `<tr><td style="${FONT}padding:12px 14px;font-size:14px;color:${INK}">` +
      `<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};font-weight:600;padding-bottom:4px">${c.action.needed ? 'What you need to do' : 'No action needed — for your information'}</div>` +
      `${multiline(c.action.text)}` +
      (due
        ? `<div style="padding-top:6px;font-weight:600;color:${TONE[due.tone]}">By ${esc(due.day)} · ${esc(due.words)}</div>`
        : '') +
      `</td></tr></table></td></tr>`,
  );
  t.push(
    c.action.needed ? 'WHAT YOU NEED TO DO' : 'NO ACTION NEEDED — FOR YOUR INFORMATION',
    c.action.text,
    ...(due ? [`By ${due.day} (${due.words})`] : []),
    '',
  );

  if (c.button) {
    b.push(
      `<tr><td style="padding:18px 0 4px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${NAVY};border-radius:6px">` +
        `<a href="${esc(c.button.url)}" style="${FONT}display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(c.button.label)}</a>` +
        `</td></tr></table></td></tr>` +
        `<tr><td style="${FONT}font-size:12px;color:${MUTED};padding-bottom:4px">Or open: <a href="${esc(c.button.url)}" style="color:${NAVY};word-break:break-all">${esc(c.button.url)}</a></td></tr>`,
    );
    t.push(`${c.button.label}: ${c.button.url}`, '');
  }

  // what happened
  const hp = c.happened;
  if (hp && (has(hp.rows) || has(hp.quotes) || has(hp.bullets))) {
    b.push(sectionTitle(hp.title));
    t.push(hp.title.toUpperCase());
    if (has(hp.rows)) {
      b.push(rowsTable(hp.rows));
      for (const r of hp.rows) t.push(`${r.label}: ${r.value}${r.href ? ` (${r.href})` : ''}`);
    }
    if (has(hp.bullets)) {
      b.push(
        `<tr><td style="${FONT}font-size:13px;color:${INK};padding-top:6px"><ul style="margin:0;padding-left:20px">${hp.bullets
          .map((x) => `<li style="padding:2px 0">${esc(x)}</li>`)
          .join('')}</ul></td></tr>`,
      );
      for (const x of hp.bullets) t.push(`- ${x}`);
    }
    if (has(hp.quotes)) {
      for (const q of hp.quotes) {
        b.push(
          `<tr><td style="padding-top:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid ${GOLD};background:#fffaf0">` +
            `<tr><td style="${FONT}padding:10px 12px;font-size:13px;color:${INK};line-height:1.5">` +
            `<div style="font-size:12px;color:${MUTED};padding-bottom:4px">${esc(q.by)}${q.when ? ` · ${esc(q.when)}` : ''}</div>${multiline(q.text)}</td></tr></table></td></tr>`,
        );
        t.push(
          `${q.by}${q.when ? ` (${q.when})` : ''}:`,
          ...q.text.split(/\r?\n/).map((l) => `  ${l}`),
        );
      }
    }
    t.push('');
  }

  for (const g of c.groups ?? []) {
    if (!g.items.length && !g.note) continue;
    const head = g.count === false ? g.title : `${g.title} (${g.items.length})`;
    b.push(sectionTitle(head));
    t.push(head.toUpperCase());
    if (g.note) {
      b.push(
        `<tr><td style="${FONT}font-size:13px;color:${INK};padding-bottom:8px">${multiline(g.note)}</td></tr>`,
      );
      t.push(g.note);
    }
    for (const it of g.items) {
      b.push(
        `<tr><td style="padding-bottom:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:6px;border-collapse:separate">` +
          `<tr><td style="${FONT}padding:10px 12px;font-size:13px;color:${INK};line-height:1.5">` +
          `<a href="${esc(it.url)}" style="color:${NAVY};font-weight:600;font-size:14px">${esc(it.title)}</a>` +
          it.lines.map((l) => `<div>${esc(l)}</div>`).join('') +
          `</td></tr></table></td></tr>`,
      );
      t.push(`* ${it.title}`, ...it.lines.map((l) => `  ${l}`), `  ${it.url}`);
    }
    t.push('');
  }

  if (has(c.details)) {
    b.push(sectionTitle('Handout details'), rowsTable(c.details));
    t.push('HANDOUT DETAILS', ...c.details.map((r) => `${r.label}: ${r.value}`), '');
  }

  if (has(c.people)) {
    b.push(
      sectionTitle('People'),
      rowsTable(
        c.people.map((p) => ({
          label: p.role,
          value: `${p.name} · ${p.email}${p.note ? ` · ${p.note}` : ''}`,
        })),
      ),
    );
    t.push(
      'PEOPLE',
      ...c.people.map((p) => `${p.role}: ${p.name} <${p.email}>${p.note ? ` (${p.note})` : ''}`),
      '',
    );
  }

  if (has(c.timeline)) {
    b.push(
      sectionTitle('Recent steps'),
      `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
        c.timeline
          .map(
            (s) =>
              `<tr><td style="${FONT}font-size:13px;color:${MUTED};padding:3px 12px 3px 0;white-space:nowrap;vertical-align:top;width:90px">${esc(s.day)}</td>` +
              `<td style="${FONT}font-size:13px;color:${INK};padding:3px 0;vertical-align:top">${esc(s.text)}</td></tr>`,
          )
          .join('') +
        `</table></td></tr>`,
    );
    t.push('RECENT STEPS', ...c.timeline.map((s) => `${s.day}  ${s.text}`), '');
  }

  h.push(
    `<tr><td style="padding:22px 24px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${b.join('')}</table></td></tr>`,
  );

  // ---- footer
  const f = c.footer;
  const reply = f.replyTo
    ? `Replies to this email go to ${f.replyTo}.`
    : 'Please do not reply to this email; it is sent automatically.';
  h.push(
    `<tr><td style="${FONT}padding:16px 24px 22px;font-size:12px;line-height:1.55;color:${MUTED};border-top:1px solid ${LINE}">` +
      `${esc(f.why)}<br>` +
      `Choose instant emails or one a day in <a href="${esc(f.settingsUrl)}" style="color:${NAVY}">My settings</a>.<br>` +
      (f.help ? `Help: ${esc(f.help)}<br>` : '') +
      `${esc(reply)}</td></tr>`,
  );
  t.push(
    '--',
    f.why,
    `Instant emails or one a day: ${f.settingsUrl}`,
    ...(f.help ? [`Help: ${f.help}`] : []),
    reply,
  );

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#e8ecf5">` +
    `<div style="display:none;max-height:0;overflow:hidden">${esc(c.summary)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8ecf5"><tr><td align="center" style="padding:20px 10px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">` +
    h.join('') +
    `</table></td></tr></table></body></html>`;

  return { subject, html, text: t.join('\n') };
}
