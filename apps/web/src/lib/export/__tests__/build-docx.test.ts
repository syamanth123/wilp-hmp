import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import type { BitsHandoutV1 } from '@hmp/db';
import { buildHandoutDocx } from '../build-docx';

const LOGO = readFileSync(join(__dirname, '..', 'assets', 'bits-header.png'));
const WATERMARK = readFileSync(join(__dirname, '..', 'assets', 'bits-watermark.png'));

const FULL: BitsHandoutV1 = {
  schemaVersion: 1,
  metadata: {
    institutionHeader: 'Birla Institute of Technology & Science, Pilani',
    divisionHeader: 'Work Integrated Learning Programmes Division',
    semester: 'First Semester 2025-2026',
    documentTitle: 'Course Handout',
    formNumber: 'F-123',
  },
  partA: {
    courseTitle: 'Software Quality Assurance and Testing',
    courseNumbers: ['SE ZG501'],
    creditUnits: 5,
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. Test Faculty'],
    versionNo: 2,
    date: '01-08-2025',
    courseDescription: '<p>This course covers <strong>QA</strong> and <em>testing</em>.</p>',
    courseObjectives: [
      { code: 'CO1', description: 'Understand QA principles' },
      { code: 'CO2', description: 'Apply test design' },
    ],
    textBooks: [{ code: 'T1', citation: 'Testing, 3rd ed.' }],
    referenceBooks: [{ code: 'R1', citation: 'QA Handbook' }],
    learningOutcomes: [{ code: 'LO1', description: 'Design test cases' }],
  },
  partB: {
    sessions: [
      {
        sessionNumber: '1',
        topicTitle: 'Introduction to QA',
        subTopics: 'history; scope',
        references: ['T1'],
      },
      {
        sessionNumber: '2-3',
        topicTitle: 'Test design',
        subTopics: 'BVA; equivalence',
        references: ['T1', 'R1'],
      },
    ],
  },
  experientialLearning: {
    overallObjective: '<p>Hands-on testing practice.</p>',
    overallScope: ['Unit testing', 'Integration testing'],
    components: [
      {
        name: 'Lab 1',
        objective: 'Write unit tests',
        outcome: 'Coverage report',
        labInfrastructure: 'JUnit',
        numberOfExercises: '4',
        scope: 'Module A',
      },
    ],
    labInfrastructure: ['CI server'],
    experiments: [{ experimentNumber: '1.', title: 'First test suite', moduleReference: 'M1' }],
  },
  evaluation: {
    legend: 'EC = Evaluation Component',
    components: [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Quiz', type: 'Online', weight: 30, duration: '1h' }],
      },
      {
        ecNumber: 'EC-2',
        subComponents: [{ name: 'Comprehensive', type: 'Closed Book', weight: 70, duration: '3h' }],
      },
    ],
    notes: '<p>Bring calculators.</p>',
    midSemSyllabus: '<p>Sessions 1-6</p>',
    compreSyllabus: '<p>All sessions</p>',
  },
  importantLinks: {
    elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
    elearnPortalNote: 'Login with your BITS ID',
    contactSessionsNote: 'Saturdays 9am',
  },
  evaluationGuidelines: '<p>No make-up without prior approval.</p>',
};

describe('buildHandoutDocx — full BITS section walk', () => {
  let zip: AdmZip;
  let documentXml: string;

  beforeAll(async () => {
    const buf = await buildHandoutDocx(FULL, LOGO, WATERMARK);
    zip = new AdmZip(buf);
    documentXml = zip.readAsText('word/document.xml');
  });

  it('produces a valid .docx (document.xml + a header part + embedded logo media)', () => {
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('word/document.xml');
    expect(names.some((n) => /word\/header\d*\.xml/.test(n))).toBe(true);
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true); // banner embedded
  });

  it('embeds the watermark behind text in the header, repeating per page', () => {
    const names = zip.getEntries().map((e) => e.entryName);
    // Two distinct images now travel in the docx: the letterhead logo + the
    // faded watermark crest.
    const media = names.filter((n) => n.startsWith('word/media/'));
    expect(media.length).toBeGreaterThanOrEqual(2);
    // The watermark is a floating image BEHIND the document text, declared in a
    // header part (headers repeat per page). `behindDoc="1"` is the OOXML marker.
    const headerXml = zip
      .getEntries()
      .filter((e) => /word\/header\d*\.xml/.test(e.entryName))
      .map((e) => zip.readAsText(e.entryName))
      .join('\n');
    expect(headerXml).toContain('behindDoc="1"');

    // Omitting the watermark → no behind-text floating image (logo only).
    return buildHandoutDocx(FULL, LOGO).then((noWm) => {
      const z = new AdmZip(noWm);
      const hx = z
        .getEntries()
        .filter((e) => /word\/header\d*\.xml/.test(e.entryName))
        .map((e) => z.readAsText(e.entryName))
        .join('\n');
      expect(hx).not.toContain('behindDoc="1"');
    });
  });

  it('includes every BITS section heading (mirrors renderBitsHandout walk)', () => {
    for (const h of [
      'Part A — Course Identification',
      'Course Objectives',
      'Text Books',
      'Reference Books',
      'Learning Outcomes',
      'Part B — Learning Plan',
      'Experiential Learning',
      'List of Experiments',
      'Evaluation Scheme',
      'Important Notes',
      'Evaluation Guidelines',
    ]) {
      expect(documentXml, `missing section: ${h}`).toContain(h);
    }
  });

  it('carries Part A content + codes', () => {
    expect(documentXml).toContain('Software Quality Assurance and Testing');
    expect(documentXml).toContain('SE ZG501');
    expect(documentXml).toContain('CO1');
    expect(documentXml).toContain('LO1');
    expect(documentXml).toContain('T1');
  });

  it('renders rich-text formatting from HTML fields (bold/italic)', () => {
    expect(documentXml).toContain('<w:b/>'); // <strong>QA</strong>
    expect(documentXml).toContain('<w:i/>'); // <em>testing</em>
  });

  it('flattens the evaluation table with weights', () => {
    expect(documentXml).toContain('EC-1');
    expect(documentXml).toContain('EC-2');
    expect(documentXml).toContain('30%');
    expect(documentXml).toContain('70%');
  });

  it('uses Arial as the default document font', () => {
    const styles = zip.readAsText('word/styles.xml');
    expect(styles).toContain('Arial');
  });

  it('sets A4 page size + 1-inch margins', () => {
    expect(documentXml).toContain('w:w="11906"'); // A4 width twips
    expect(documentXml).toContain('w:top="1440"'); // 1 inch
  });

  it('omits the experiential section gracefully when absent', async () => {
    const noExp: BitsHandoutV1 = { ...FULL, experientialLearning: undefined };
    const buf = await buildHandoutDocx(noExp, LOGO);
    const xml = new AdmZip(buf).readAsText('word/document.xml');
    expect(xml).not.toContain('Experiential Learning');
    expect(xml).toContain('Part B — Learning Plan'); // rest intact
  });
});
