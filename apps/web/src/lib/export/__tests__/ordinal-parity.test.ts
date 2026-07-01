import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { renderBitsHandout, type BitsHandoutV1 } from '@hmp/db';
import { buildHandoutDocx } from '../build-docx';

const LOGO = readFileSync(join(__dirname, '..', 'assets', 'bits-header.png'));

// Minimal valid handout with DELIBERATELY scrambled stored CO/T/R/LO codes —
// both consumers must derive CO1.., T1.., R1.., LO1.. from position and ignore
// the stored values.
const H: BitsHandoutV1 = {
  schemaVersion: 1,
  metadata: {
    institutionHeader: 'BITS',
    divisionHeader: 'WILP',
    semester: 'Sem-I 2025-26',
    documentTitle: 'Course Handout',
    formNumber: 'F-1',
  },
  partA: {
    courseTitle: 'Ordinal Test',
    courseNumbers: ['XX ZC999'],
    creditModel: { description: '3-0-0' },
    instructors: ['Dr. X'],
    date: '01-01-2026',
    courseDescription: '<p>desc</p>',
    courseObjectives: [
      { code: 'CO99', description: 'co-alpha' },
      { code: 'CO98', description: 'co-beta' },
    ],
    textBooks: [
      { code: 'T99', citation: 'tb-alpha' },
      { code: 'T98', citation: 'tb-beta' },
    ],
    referenceBooks: [{ code: 'R99', citation: 'rb-alpha' }],
    learningOutcomes: [{ code: 'LO99', description: 'lo-alpha' }],
  },
  partB: { sessions: [{ sessionNumber: '1', topicTitle: 'T', subTopics: '', references: [] }] },
  evaluation: {
    legend: 'EC',
    components: [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Q', type: 'Online', weight: 100, duration: '1h' }],
      },
    ],
    notes: '',
    midSemSyllabus: '',
    compreSyllabus: '',
  },
  importantLinks: {
    elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
    elearnPortalNote: '',
    contactSessionsNote: '',
  },
  evaluationGuidelines: '',
};

describe('ordinal derivation — renderer / docx parity', () => {
  it('both consumers derive identical position codes and ignore the stored code', async () => {
    const html = renderBitsHandout(H);
    const zip = new AdmZip(await buildHandoutDocx(H, LOGO));
    const xml = zip.readAsText('word/document.xml');

    for (const code of ['CO1', 'CO2', 'T1', 'T2', 'R1', 'LO1']) {
      expect(html, `HTML missing ${code}`).toContain(code);
      expect(xml, `docx missing ${code}`).toContain(code);
    }
    // Neither surface leaks a scrambled stored code.
    for (const stored of ['CO99', 'CO98', 'T99', 'T98', 'R99', 'LO99']) {
      expect(html, `HTML leaked stored ${stored}`).not.toContain(stored);
      expect(xml, `docx leaked stored ${stored}`).not.toContain(stored);
    }
  });
});
