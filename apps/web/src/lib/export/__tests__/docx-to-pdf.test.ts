import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BitsHandoutV1 } from '@hmp/db';
import { buildHandoutDocx } from '../build-docx';
import { docxToPdf, libreOfficeAvailable, PdfConversionError } from '../docx-to-pdf';

/**
 * PDF conversion is infra-dependent (LibreOffice headless). Probe-skips when
 * `soffice` is absent (local dev without LibreOffice — like the MinIO specs),
 * runs where LibreOffice is installed (CI/EC2). Risk-6 discipline.
 */

const LOGO = readFileSync(join(__dirname, '..', 'assets', 'bits-header.png'));

const MINIMAL: BitsHandoutV1 = {
  schemaVersion: 1,
  metadata: {
    institutionHeader: 'Birla Institute of Technology & Science, Pilani',
    divisionHeader: 'Work Integrated Learning Programmes Division',
    semester: 'First Semester 2025-2026',
    documentTitle: 'Course Handout',
    formNumber: '',
  },
  partA: {
    courseTitle: 'Test Course',
    courseNumbers: ['SE ZG501'],
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. X'],
    date: '01-08-2025',
    courseDescription: '<p>Desc.</p>',
    courseObjectives: [{ code: 'CO1', description: 'obj' }],
    textBooks: [{ code: 'T1', citation: 'book' }],
    referenceBooks: [],
    learningOutcomes: [{ code: 'LO1', description: 'out' }],
  },
  partB: { sessions: [{ sessionNumber: '1', topicTitle: 'Intro', subTopics: '', references: [] }] },
  evaluation: {
    legend: '',
    components: [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Quiz', type: 'Online', weight: 100, duration: '1h' }],
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
  evaluationGuidelines: '<p>Guidelines.</p>',
};

describe('docxToPdf (LibreOffice headless)', () => {
  let available = false;
  beforeAll(async () => {
    available = await libreOfficeAvailable();
    if (!available)
      console.warn('[docx-to-pdf.test] LibreOffice not found — skipping conversion (CI/EC2 only).');
  });

  it('converts a real handout docx to a PDF (%PDF header)', async () => {
    if (!available) return;
    const docx = await buildHandoutDocx(MINIMAL, LOGO);
    const started = Date.now();
    const pdf = await docxToPdf(docx);
    const ms = Date.now() - started;
    console.log(`[docx-to-pdf.test] conversion took ${ms}ms`);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-'); // PDF magic
  }, 60_000);

  it('PdfConversionError carries a typed kind for the route to branch on', () => {
    // The route maps kind==='missing-binary' → 503, else → 500. Lock the contract.
    const e = new PdfConversionError('x', 'missing-binary', { code: 'ENOENT' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('PdfConversionError');
    expect(e.kind).toBe('missing-binary');
  });
});
