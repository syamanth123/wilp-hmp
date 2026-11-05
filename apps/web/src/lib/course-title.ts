// Course titles for display. The Course Dibba types titles in capitals ("IOT IN MANUFACTURING");
// lists show them in title case ("IoT in Manufacturing"), keeping the usual acronyms. A title
// that already has lower-case letters (the course catalogue's) is left as it is.

/** Acronyms kept as written here (matched case-insensitively). */
const ACRONYMS = [
  'AI',
  'ML',
  'IoT',
  'IT',
  'VLSI',
  'MEMS',
  'IC',
  'API',
  'APIs',
  'CAD',
  'CAM',
  'CAE',
  'RF',
  'GIS',
  'HR',
  'RTL',
  'WW',
  'MOS',
  'CMOS',
  'DSP',
  'ERP',
  'CRM',
  'SAP',
  'UX',
  'UI',
  'NLP',
  'GPU',
  'SQL',
  'AR',
  'VR',
  'PLC',
  'SCADA',
  'HVAC',
  'CNC',
  'FEM',
  'CFD',
  'ASIC',
  'FPGA',
  'SoC',
  'ESG',
  'IPR',
  'DBMS',
  'OS',
  'MBA',
  'BITS',
  'WILP',
  'R&D',
  'QA',
  'QC',
  'TQM',
  'PCB',
  'LTE',
  '5G',
  'IIoT',
  'DevOps',
  'MLOps',
  'SaaS',
  'NoSQL',
  'IPv6',
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
];
const ACRONYM = new Map(ACRONYMS.map((a) => [a.toUpperCase(), a]));

/** Small words written in lower case unless they start the title. */
const SMALL = new Set('a an and as at by for from in into of on or the to via vs with'.split(' '));

function word(w: string, first: boolean): string {
  const known = ACRONYM.get(w.toUpperCase());
  if (known) return known;
  const lower = w.toLowerCase();
  if (!first && SMALL.has(lower)) return lower;
  return lower[0]!.toUpperCase() + lower.slice(1);
}

/** "ENGINEERING MATERIALS" → "Engineering Materials"; "IOT IN MANUFACTURING" → "IoT in Manufacturing". */
export function titleCase(title: string): string {
  let first = true;
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z0-9&]+/g, (w) => {
      const out = word(w, first);
      first = false;
      return out;
    });
}

/** Mostly capitals ("IOT IN MANUFACTURING", or the Dibba's "IoT IN MANUFACTURING"). */
function shouting(t: string): boolean {
  const lower = (t.match(/[a-z]/g) ?? []).length;
  const upper = (t.match(/[A-Z]/g) ?? []).length;
  return upper > 0 && lower < upper / 4;
}

/** The title to show: the catalogue's when there is one, else the given title, title-cased if it is mostly capitals. */
export function displayCourseTitle(title: string, catalogueTitle?: string | null): string {
  const t = catalogueTitle?.trim() || title.trim();
  return shouting(t) ? titleCase(t) : t;
}
