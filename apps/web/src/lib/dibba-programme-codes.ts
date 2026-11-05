import { prisma, type Prisma } from '@hmp/db';
import { parseCsv } from '@hmp/integrations';

/**
 * Course Dibba programme codes → HMP programmes (v1.3.0, docs/plans/taxila-publish.md §A).
 *
 * The Dibba names programmes by batch code ("18BT/18ET", "HT15", "MB21/HB21"); HMP programmes have
 * their own codes ("MTECH-SE"). Admin links the two. One rule everywhere ("Create request", the
 * Handout Library's programme filter): a link row wins; without one, a code that equals an HMP
 * programme code — the whole string or one "/" part — still matches. Inactive programmes never do.
 */

export interface ProgrammeRef {
  id: string;
  code: string;
  active: boolean;
}

export type DibbaProgrammeLinks = {
  /** Dibba code (as imported) → the HMP programme it is linked to. */
  mappings: Map<string, ProgrammeRef>;
  programmes: ProgrammeRef[];
};

export type ResolvedProgramme =
  | { programme: ProgrammeRef; via: 'link' | 'code' }
  | { programme: null; via: 'none' };

export function resolveDibbaProgramme(code: string, links: DibbaProgrammeLinks): ResolvedProgramme {
  const linked = links.mappings.get(code);
  if (linked?.active) return { programme: linked, via: 'link' };
  const parts = [code, ...code.split('/')].map((p) => p.trim().toUpperCase());
  const exact = links.programmes.find(
    (p) => p.active && parts.includes(p.code.trim().toUpperCase()),
  );
  return exact ? { programme: exact, via: 'code' } : { programme: null, via: 'none' };
}

export async function loadDibbaProgrammeLinks(): Promise<DibbaProgrammeLinks> {
  const [rows, programmes] = await Promise.all([
    prisma.dibbaProgrammeCode.findMany({
      select: { code: true, programme: { select: { id: true, code: true, active: true } } },
    }),
    prisma.programme.findMany({ select: { id: true, code: true, active: true } }),
  ]);
  return { mappings: new Map(rows.map((r) => [r.code, r.programme])), programmes };
}

export interface DibbaCodeRow {
  code: string;
  title: string;
  courses: number;
  linkedProgrammeId: string | null;
  /** How it resolves today: through the link, by matching an HMP code, or not at all. */
  resolved: ResolvedProgramme;
  /** Unlinked codes only: an HMP programme with a similar name (Admin decides). */
  suggestion: { id: string; code: string; name: string } | null;
}

/** Every programme code in the published Course Dibbas, for the Admin page. */
export async function loadDibbaCodeRows(): Promise<DibbaCodeRow[]> {
  const [entries, links, named] = await Promise.all([
    prisma.dibbaEntry.findMany({
      where: { import: { status: 'PUBLISHED' } },
      select: { programmeCode: true, programmeTitle: true, courseCode: true },
    }),
    loadDibbaProgrammeLinks(),
    prisma.programme.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const by = new Map<string, { title: string; courses: Set<string> }>();
  for (const e of entries) {
    const r = by.get(e.programmeCode) ?? { title: e.programmeTitle, courses: new Set<string>() };
    r.courses.add(e.courseCode);
    by.set(e.programmeCode, r);
  }
  return [...by]
    .map(([code, r]) => {
      const title = plainTitle(code, r.title);
      const resolved = resolveDibbaProgramme(code, links);
      return {
        code,
        title,
        courses: r.courses.size,
        linkedProgrammeId: links.mappings.get(code)?.id ?? null,
        resolved,
        suggestion: resolved.programme ? null : (suggestProgramme(title, named)?.programme ?? null),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** "18BT/18ET B.Tech. (Engineering Technology)" → "B.Tech. (Engineering Technology)". */
function plainTitle(code: string, title: string): string {
  const t = title.trim();
  return t.toUpperCase().startsWith(code.toUpperCase()) ? t.slice(code.length).trim() : t;
}

export type MappingResult = { ok: true; changed: number } | { ok: false; error: string };

async function knownDibbaCodes(): Promise<Set<string>> {
  const rows = await prisma.dibbaEntry.findMany({
    where: { import: { status: 'PUBLISHED' } },
    distinct: ['programmeCode'],
    select: { programmeCode: true },
  });
  return new Set(rows.map((r) => r.programmeCode));
}

async function writeMappings(
  actorId: string,
  changes: { code: string; programmeId: string | null }[],
  extra: Record<string, unknown> = {},
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    let changed = 0;
    for (const c of changes) {
      const before = await tx.dibbaProgrammeCode.findUnique({
        where: { code: c.code },
        select: { programmeId: true, programme: { select: { code: true } } },
      });
      if ((before?.programmeId ?? null) === c.programmeId) continue; // nothing to change
      let afterCode: string | null = null;
      if (c.programmeId) {
        const row = await tx.dibbaProgrammeCode.upsert({
          where: { code: c.code },
          update: { programmeId: c.programmeId, updatedById: actorId },
          create: { code: c.code, programmeId: c.programmeId, updatedById: actorId },
          select: { programme: { select: { code: true } } },
        });
        afterCode = row.programme.code;
      } else {
        await tx.dibbaProgrammeCode.delete({ where: { code: c.code } });
      }
      changed++;
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'dibba.programme_map.update',
          entity: 'DibbaProgrammeCode',
          entityId: c.code,
          before: { code: c.code, programme: before?.programme.code ?? null },
          after: { code: c.code, programme: afterCode, ...extra } as Prisma.InputJsonValue,
        },
      });
    }
    return changed;
  });
}

/** Link one Dibba code to an HMP programme, or unlink it (programmeId null). */
export async function setDibbaCodeMapping(
  actorId: string,
  code: string,
  programmeId: string | null,
): Promise<MappingResult> {
  if (!(await knownDibbaCodes()).has(code))
    return { ok: false, error: `${code} isn't in any published Course Dibba.` };
  if (programmeId) {
    const p = await prisma.programme.findUnique({ where: { id: programmeId } });
    if (!p) return { ok: false, error: 'That programme no longer exists. Reload the page.' };
    if (!p.active)
      return { ok: false, error: `${p.code} is inactive, so codes can't be linked to it.` };
  }
  return { ok: true, changed: await writeMappings(actorId, [{ code, programmeId }]) };
}

export interface CsvError {
  line: number;
  message: string;
}

export type CsvResult =
  | { ok: true; changed: number; rows: number }
  | { ok: false; errors: CsvError[] };

export const DIBBA_CODE_CSV_COLUMNS = ['code', 'programme_code'] as const;

/**
 * Bulk links from a CSV `code,programme_code`. Every row is checked first; one bad row rejects the
 * whole file (nothing is saved) and the list says which rows to fix.
 */
export async function applyDibbaCodeCsv(actorId: string, csv: string): Promise<CsvResult> {
  const { header, rows } = parseCsv(csv);
  const missing = DIBBA_CODE_CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length)
    return {
      ok: false,
      errors: [{ line: 1, message: `Missing column(s): ${missing.join(', ')}.` }],
    };
  if (rows.length === 0)
    return { ok: false, errors: [{ line: 1, message: 'The file has no rows.' }] };
  if (rows.length > 500)
    return { ok: false, errors: [{ line: 1, message: 'At most 500 rows per file.' }] };

  const [known, programmes] = await Promise.all([
    knownDibbaCodes(),
    prisma.programme.findMany({ select: { id: true, code: true, active: true } }),
  ]);
  const byCode = new Map(programmes.map((p) => [p.code.toUpperCase(), p]));
  const errors: CsvError[] = [];
  const seen = new Set<string>();
  const changes: { code: string; programmeId: string }[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const code = (r.code ?? '').trim();
    const pc = (r.programme_code ?? '').trim();
    if (!code) return errors.push({ line, message: 'code is empty.' });
    if (!known.has(code))
      return errors.push({ line, message: `${code} isn't in any published Course Dibba.` });
    if (seen.has(code)) return errors.push({ line, message: `${code} appears twice in the file.` });
    seen.add(code);
    const p = byCode.get(pc.toUpperCase());
    if (!pc) return errors.push({ line, message: 'programme_code is empty.' });
    if (!p) return errors.push({ line, message: `No HMP programme has the code ${pc}.` });
    if (!p.active) return errors.push({ line, message: `${p.code} is inactive.` });
    changes.push({ code, programmeId: p.id });
  });
  if (errors.length) return { ok: false, errors };
  const changed = await writeMappings(actorId, changes, { source: 'csv' });
  return { ok: true, changed, rows: changes.length };
}

// ── Suggestions by name (Admin still decides; nothing is linked automatically) ─────────────────

const DEGREES: [RegExp, string][] = [
  [/\bm\.?\s*tech\b\.?/g, ' mtech '],
  [/\bb\.?\s*tech\b\.?/g, ' btech '],
  [/\bm\.?\s*sc\b\.?/g, ' msc '],
  [/\bb\.?\s*sc\b\.?/g, ' bsc '],
  [/\bm\.?\s*e\b\.(?=\s)/g, ' me '],
  [/\bpg\s*diploma\b/g, ' pgdiploma '],
  [/\bm\.?\s*b\.?\s*a\b\.?/g, ' mba '],
];
const DEGREE_WORDS = new Set(['mtech', 'btech', 'msc', 'bsc', 'me', 'pgdiploma', 'mba']);
/** Words that say nothing about the subject ("No Admission from last 3 semesters", "Backlog only"…). */
const NOISE = new Set(
  'and of in the for with wilp programme program new revised structure backlog only no batch admission from last semesters semester'.split(
    ' ',
  ),
);

/** Subject words too common to show two programmes are related on their own. */
const GENERIC = new Set(
  'engineering management technology technologies systems system science sciences studies design operations'.split(
    ' ',
  ),
);

function nameParts(name: string): { degree: string | null; words: Set<string> } {
  let t = ` ${name.toLowerCase()} `;
  for (const [re, w] of DEGREES) t = t.replace(re, w);
  const tokens = t
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const degree = tokens.find((w) => DEGREE_WORDS.has(w)) ?? null;
  const words = new Set(
    tokens.filter((w) => !DEGREE_WORDS.has(w) && !NOISE.has(w) && !/^\d+$/.test(w)),
  );
  return { degree, words };
}

/**
 * The HMP programme whose name looks most like a Dibba programme title — same degree (M.Tech, MBA…)
 * and at least half the subject words in common (Dice ≥ 0.5), one of them specific (not just
 * "engineering" or "management"). Null when nothing is close enough.
 */
export function suggestProgramme<P extends { code: string; name: string }>(
  dibbaTitle: string,
  programmes: P[],
): { programme: P; score: number } | null {
  const a = nameParts(dibbaTitle);
  let best: { programme: P; score: number } | null = null;
  for (const p of programmes) {
    const b = nameParts(p.name);
    if (a.degree && b.degree && a.degree !== b.degree) continue;
    if (!a.words.size || !b.words.size) continue;
    const common = [...a.words].filter((w) => b.words.has(w));
    // At least one shared word must be specific ("software", "data") — not just "engineering" —
    // unless the subjects are exactly the same ("Engineering Technology" = "Engineering Technology").
    const identical = common.length === a.words.size && common.length === b.words.size;
    if (!identical && !common.some((w) => !GENERIC.has(w))) continue;
    const shared = common.length;
    const score = (2 * shared) / (a.words.size + b.words.size);
    if (score >= 0.5 && (!best || score > best.score)) best = { programme: p, score };
  }
  return best;
}
