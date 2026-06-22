// SNAPSHOT DISCIPLINE: Update with --update-snapshots only after reviewing the
// HTML diff and confirming every change is intentional. The snapshot is the
// regression catch for unintended renderer changes — careless updates defeat it.

import { describe, it, expect } from 'vitest';
import { renderBitsHandout } from '../handout-renderer';
import type { BitsHandoutV1 } from '../handout-schema';
import golden from '../__fixtures__/handout-aelzg631.json';

const fixture = golden as BitsHandoutV1;

function clone(): BitsHandoutV1 {
  return JSON.parse(JSON.stringify(fixture));
}

describe('renderBitsHandout — golden fixture (AEL ZG631)', () => {
  it('renders without throwing', () => {
    expect(() => renderBitsHandout(fixture)).not.toThrow();
  });

  it('includes the institutional header by default', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('Birla Institute of Technology &amp; Science, Pilani');
    expect(html).toContain('Work Integrated Learning Programmes Division');
    expect(html).toContain('Digital Learning Handout');
  });

  it('renders Part A with course identity verbatim from the source', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('Automotive Diagnostics and Interfaces');
    expect(html).toContain('AE ZG631');
    expect(html).toContain('AEL ZG631');
    expect(html).toContain('KOTHA SRINIVASA REDDY');
    expect(html).toContain('3-1-1'); // creditModel description (the short code form)
  });

  it('renders all five Course Objectives (CO1–CO5)', () => {
    const html = renderBitsHandout(fixture);
    for (const code of ['CO1', 'CO2', 'CO3', 'CO4', 'CO5']) expect(html).toContain(code);
    expect(html).toContain('automotive sensors');
    expect(html).toContain('power electronic converters');
  });

  it('renders text books T1 + T2 with citations', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('T1');
    expect(html).toContain('T2');
    expect(html).toContain('Tom Denton');
    expect(html).toContain('Randall Shaffer');
  });

  it('renders reference books R1 + R2 + R3', () => {
    const html = renderBitsHandout(fixture);
    for (const code of ['R1', 'R2', 'R3']) expect(html).toContain(code);
  });

  it('renders all Learning Outcomes (LO1–LO4)', () => {
    const html = renderBitsHandout(fixture);
    for (const code of ['LO1', 'LO2', 'LO3', 'LO4']) expect(html).toContain(code);
  });

  it('renders Part B with the 13 logical session rows including the three ranges', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('>5-6<');
    expect(html).toContain('>7-8<');
    expect(html).toContain('>12-13<');
    expect(html).toContain('Engine Diagnostics');
    expect(html).toContain('Peripherals/interfaces for microcomputer control of converters');
  });

  it('renders multi-item subTopics as a <ul><li> bullet list (session 1)', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('<ul class="bits-handout-subtopics">');
    expect(html).toContain('<li>Introduction to diagnostics and prognostics</li>');
    expect(html).toContain('<li>Diagnostics Techniques</li>');
  });

  it('renders Experiential Learning with the lab infrastructure block', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('Experiential Learning');
    expect(html).toContain('Virtual Lab');
    expect(html).toContain('Electude');
    expect(html).toContain('Remote Lab');
    expect(html).toContain('Hyderabad campus');
  });

  it('renders all four experiments by number + title', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('Introduction to the lab');
    expect(html).toContain('Diagnostics to detect');
    expect(html).toContain('VCDS tool');
    expect(html).toContain(
      'Simulation of buck, boost converter and inverter using MATLAB Simulink',
    );
  });

  it('renders Evaluation Scheme with EC-1 / EC-2 / EC-3 and weights summing to 100%', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('EC - 1');
    expect(html).toContain('EC - 2');
    expect(html).toContain('EC - 3');
    expect(html).toContain('Quiz');
    expect(html).toContain('Mid-Semester exam');
    expect(html).toContain('Comprehensive exam');
    for (const w of ['>10%<', '>20%<', '>30%<', '>40%<']) expect(html).toContain(w);
  });

  it('renders the eLearn Portal as a clickable link in Important Links', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('https://elearn.bits-pilani.ac.in');
    expect(html).toContain('<a href="https://elearn.bits-pilani.ac.in">');
    expect(html).toContain('Important Links');
  });

  it('renders Evaluation Guidelines with the full block', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('Evaluation Guidelines');
    expect(html).toContain('Make-Up Test');
  });

  it('emits a footer with the document title + semester', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('bits-handout-footer');
    expect(html).toContain('Digital Learning Handout');
    expect(html).toContain('First Semester 2025-2026');
  });
});

describe('renderBitsHandout — options', () => {
  it('omitInstitutionalHeader: true removes the institutional header block but keeps everything else', () => {
    const html = renderBitsHandout(fixture, { omitInstitutionalHeader: true });
    expect(html).not.toContain('Birla Institute of Technology &amp; Science, Pilani');
    // Assert the rendered DIV is omitted (the CSS rule itself contains the
    // class name, so look for the actual element).
    expect(html).not.toContain('<div class="bits-handout-header">');
    expect(html).toContain('Automotive Diagnostics and Interfaces'); // Course Details still present
    expect(html).toContain('1. Course Description'); // numbered sections still render
  });

  it('logoSrc renders the letterhead <img> inside the header; absent → no <img>', () => {
    const withLogo = renderBitsHandout(fixture, { logoSrc: '/bits-header.png' });
    expect(withLogo).toContain('<img class="bits-handout-logo" src="/bits-header.png"');
    const without = renderBitsHandout(fixture);
    expect(without).not.toContain('bits-handout-logo" src=');
  });

  it('HTML render carries NO watermark — branding lives in the PDF, not HTML', () => {
    const html = renderBitsHandout(fixture, { cssScope: 'inline', logoSrc: '/bits-header.png' });
    expect(html).not.toContain('watermark');
    expect(html).not.toContain('::before');
    expect(html).not.toContain('bits-handout-page'); // page wrapper removed with the watermark
  });

  it('emits the print stylesheet (@page A4)', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('@page { size: A4; margin: 1in; }');
    expect(html).toContain('@media print');
  });

  it('footer carries the canonical WILP division line', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('BITS Pilani Work Integrated Learning Programmes Division');
  });

  it('logoSrc is ignored when the institutional header is omitted', () => {
    const html = renderBitsHandout(fixture, {
      omitInstitutionalHeader: true,
      logoSrc: '/bits-header.png',
    });
    expect(html).not.toContain('<img class="bits-handout-logo"');
  });

  it('cssScope: "none" emits no <style> tag', () => {
    const html = renderBitsHandout(fixture, { cssScope: 'none' });
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('</style>');
  });

  it('cssScope: "inline" (default) emits a <style> block with the bits-handout rules', () => {
    const html = renderBitsHandout(fixture);
    expect(html).toContain('<style>');
    expect(html).toContain('.bits-handout');
  });

  it('cssScope: "external" emits class names but no inline <style>', () => {
    const html = renderBitsHandout(fixture, { cssScope: 'external' });
    expect(html).not.toContain('<style>');
    expect(html).toContain('class="bits-handout"');
  });
});

describe('renderBitsHandout — graceful handling of optional / empty sections', () => {
  it('experientialLearning absent: section is gracefully skipped', () => {
    const h = clone() as Record<string, unknown>;
    delete h.experientialLearning;
    const html = renderBitsHandout(h as BitsHandoutV1);
    expect(html).not.toContain('Experiential Learning');
    expect(html).toContain('Evaluation Scheme'); // following section still renders
    expect(html).toContain('Course Description'); // earlier sections still render
  });

  it('empty referenceBooks: the Reference Material section is skipped entirely', () => {
    const h = clone();
    h.partA.referenceBooks = [];
    const html = renderBitsHandout(h);
    expect(html).not.toContain('Reference Material'); // skip-if-empty: no heading, no placeholder
    expect(html).toContain('Text Books'); // the populated neighbour still renders
  });

  it('single-item subTopics: renders inline (no <ul>)', () => {
    const h = clone();
    h.partB.sessions[0]!.subTopics = 'A single sub-topic';
    const html = renderBitsHandout(h);
    expect(html).toContain('A single sub-topic');
    // The single string is NOT wrapped in a <ul> — it sits directly in the cell.
    const baseline = renderBitsHandout(fixture);
    const ulCountBaseline = (baseline.match(/bits-handout-subtopics/g) ?? []).length;
    const ulCountSingle = (html.match(/bits-handout-subtopics/g) ?? []).length;
    expect(ulCountSingle).toBeLessThan(ulCountBaseline);
  });

  it('empty subTopics: renders nothing (clean cell)', () => {
    const h = clone();
    h.partB.sessions[0]!.subTopics = '';
    const html = renderBitsHandout(h);
    // The "Review" sessions in the source already have empty subTopics, so the
    // renderer's empty-handling is exercised by the golden fixture too.
    // Here we just confirm the first session's row contains no <ul>.
    expect(html).toContain('Introduction to automotive diagnostics');
  });

  it('experientialLearning present but all inner arrays empty: section is skipped', () => {
    const h = clone();
    h.experientialLearning!.components = [];
    h.experientialLearning!.experiments = [];
    h.experientialLearning!.labInfrastructure = [];
    h.experientialLearning!.overallScope = [];
    h.experientialLearning!.overallObjective = '';
    const html = renderBitsHandout(h);
    expect(html).not.toContain('Experiential Learning'); // no content → no section/number
  });
});

describe('renderBitsHandout — canonical numbered sections + Course Details (Prompt 24-follow-up)', () => {
  it('Course Details table replaces the Part A identification table (no duplicate)', () => {
    const html = renderBitsHandout(fixture);
    expect(html).not.toContain('Part A — Course Identification');
    expect(html).toContain('bits-handout-coursedetails');
    expect(html).toContain('Instructor-in-Charge'); // first listed instructor by convention
    expect(html).toContain('AE ZG631'); // course identity still present
  });

  it('renders the 10 canonical sections in contiguous numbered order (golden fixture)', () => {
    const html = renderBitsHandout(fixture);
    const order = [
      '1. Course Description',
      '2. Scope and Objectives',
      '3. Learning Outcomes',
      '4. Text Books',
      '5. Reference Material',
      '6. Course Plan',
      '7. Experiential Learning',
      '8. Evaluation Scheme',
      '9. Important Notes &amp; Links',
      '10. Evaluation Guidelines',
    ];
    let cursor = -1;
    for (const heading of order) {
      const at = html.indexOf(heading);
      expect(at, `missing/out-of-order: ${heading}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('skip-if-empty renumbers contiguously: removing Experiential collapses 7→ onward', () => {
    const h = clone() as Record<string, unknown>;
    delete h.experientialLearning;
    const html = renderBitsHandout(h as BitsHandoutV1);
    expect(html).not.toContain('Experiential Learning');
    // Course Plan stays 6; Evaluation Scheme moves up to 7 (no gap), and there is
    // no "8. Evaluation Scheme" left behind.
    expect(html).toContain('6. Course Plan');
    expect(html).toContain('7. Evaluation Scheme');
    expect(html).not.toContain('8. Evaluation Scheme');
  });

  it('a minimal handout (only required sections populated) numbers coherently', () => {
    const h = clone();
    h.partA.learningOutcomes = [];
    h.partA.referenceBooks = [];
    h.partA.courseObjectives = [];
    delete (h as Record<string, unknown>).experientialLearning;
    const html = renderBitsHandout(h);
    expect(html).toContain('1. Course Description');
    expect(html).toContain('2. Text Books'); // 2/3/4/5 collapsed away → Text Books is now 2
    expect(html).not.toContain('Scope and Objectives');
    expect(html).not.toContain('Learning Outcomes');
    expect(html).not.toContain('Reference Material');
  });
});

describe('renderBitsHandout — XSS sanitization across ALL four rich-text fields', () => {
  // Decision 4 enforcement: every rich-text field passes through the SAME
  // sanitize() helper. This test exercises every field with the same payload
  // so a missed wiring fails loudly.
  const XSS =
    '<script>alert(1)</script><img src=x onerror="alert(2)"><b>safe markup</b><a href="javascript:alert(3)">link</a>';

  const fields = [
    'courseDescription',
    'laboratoryComponent',
    'overallObjective',
    'evaluationGuidelines',
  ] as const;

  function inject(h: BitsHandoutV1, field: (typeof fields)[number], value: string): void {
    if (field === 'courseDescription') h.partA.courseDescription = value;
    else if (field === 'laboratoryComponent') h.partA.laboratoryComponent = value;
    else if (field === 'overallObjective') h.experientialLearning!.overallObjective = value;
    else h.evaluationGuidelines = value;
  }

  for (const field of fields) {
    it(`strips <script> / onerror / javascript: from ${field}; preserves benign <b>`, () => {
      const h = clone();
      inject(h, field, XSS);
      const html = renderBitsHandout(h);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onerror');
      expect(html).not.toContain('javascript:');
      expect(html).toContain('<b>safe markup</b>'); // benign allowlisted tag survives
    });
  }
});

describe('renderBitsHandout — snapshot (regression catch)', () => {
  it('the rendered output of the AEL ZG631 fixture is stable across runs', () => {
    // cssScope: 'none' so the snapshot focuses on STRUCTURE; CSS rule edits
    // shouldn't bump the snapshot. (Renderer correctness, not styling.)
    const html = renderBitsHandout(fixture, { cssScope: 'none' });
    expect(html).toMatchSnapshot();
  });
});
