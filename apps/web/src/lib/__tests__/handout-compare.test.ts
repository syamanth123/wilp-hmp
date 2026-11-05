import { describe, expect, it } from 'vitest';
import { BitsHandoutSchemaV1, type BitsHandoutV1 } from '@hmp/db';
import {
  CHANGE_SIZE_LABEL,
  changeSize,
  compareHandouts,
  diffWords,
  stripHtml,
  type CompareRow,
  type HandoutComparison,
} from '../handout-compare';

/** Minimal valid handout; `patch` mutates a deep copy. */
function makeHandout(patch?: (h: BitsHandoutV1) => void): BitsHandoutV1 {
  const h: BitsHandoutV1 = {
    schemaVersion: 1,
    metadata: {
      institutionHeader: 'Birla Institute of Technology & Science, Pilani',
      divisionHeader: 'Work Integrated Learning Programmes Division',
      semester: 'First Semester 2025-2026',
      documentTitle: 'Course Handout',
      formNumber: 'F-1',
    },
    partA: {
      courseTitle: 'Software Architectures',
      courseNumbers: ['SS ZG653'],
      creditUnits: 4,
      creditModel: { description: '3-1-0' },
      instructors: ['Dr. A. Kumar'],
      versionNo: 1,
      date: '01-08-2025',
      courseDescription: '<p>Architecture styles and quality attributes.</p>',
      courseObjectives: [
        { code: 'CO1', description: 'Understand architecture styles' },
        { code: 'CO2', description: 'Evaluate quality attributes' },
      ],
      textBooks: [{ code: 'T1', citation: 'Bass, Software Architecture in Practice' }],
      referenceBooks: [{ code: 'R1', citation: 'Fowler, Patterns of Enterprise Apps' }],
      learningOutcomes: [{ code: 'LO1', description: 'Design a layered system' }],
    },
    partB: {
      sessions: [
        {
          sessionNumber: '1',
          topicTitle: 'Introduction',
          subTopics: 'history; scope',
          references: ['T1'],
        },
        {
          sessionNumber: '2-3',
          topicTitle: 'Architecture styles',
          subTopics: 'layered; pipes and filters',
          references: ['T1', 'R1'],
        },
      ],
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
          subComponents: [
            { name: 'Comprehensive', type: 'Closed Book', weight: 70, duration: '3h' },
          ],
        },
      ],
      notes: '<p>Bring your ID.</p>',
      midSemSyllabus: '<p>Sessions 1-8</p>',
      compreSyllabus: '<p>All sessions</p>',
    },
    importantLinks: {
      elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
      elearnPortalNote: 'Check the portal.',
      contactSessionsNote: 'Weekends.',
    },
    evaluationGuidelines: '<p>No make-up without approval.</p>',
  };
  const copy = structuredClone(h);
  patch?.(copy);
  return copy;
}

const section = (c: HandoutComparison, key: string) => {
  const s = c.sections.find((x) => x.key === key);
  if (!s) throw new Error(`section ${key} missing`);
  return s;
};
const row = (c: HandoutComparison, sectionKey: string, label: string): CompareRow => {
  const r = section(c, sectionKey).rows.find((x) => x.label === label);
  if (!r) throw new Error(`row ${label} missing in ${sectionKey}`);
  return r;
};

describe('fixture', () => {
  it('is a valid BitsHandoutV1', () => {
    expect(BitsHandoutSchemaV1.safeParse(makeHandout()).success).toBe(true);
  });
});

describe('compareHandouts', () => {
  it('identical handouts → no changes, every row same', () => {
    const c = compareHandouts(makeHandout(), makeHandout());
    expect(c.size).toBe('none');
    expect(c.changedRows).toBe(0);
    expect(c.totalRows).toBeGreaterThan(10);
    for (const s of c.sections) {
      expect(s.changed).toBe(0);
      for (const r of s.rows) expect(r.kind).toBe('same');
    }
    // No experiential section on either side → omitted.
    expect(c.sections.map((s) => s.key)).toEqual([
      'courseDetails',
      'courseDescription',
      'courseObjectives',
      'textBooks',
      'referenceBooks',
      'learningOutcomes',
      'sessions',
      'evaluation',
      'evaluationGuidelines',
    ]);
  });

  it('ignores HTML markup, whitespace and nbsp differences', () => {
    const after = makeHandout((h) => {
      h.partA.courseDescription =
        'Architecture   styles&nbsp;and <strong>quality</strong>\n attributes.';
      h.evaluationGuidelines = '<div><span>No make-up</span> without&#160;approval.</div>';
      h.evaluation.notes = 'Bring your ID.';
    });
    const c = compareHandouts(makeHandout(), after);
    expect(c.changedRows).toBe(0);
    expect(row(c, 'courseDescription', 'Course description')).toMatchObject({
      kind: 'same',
      before: 'Architecture styles and quality attributes.',
    });
  });

  it('matches objectives by code: added, removed, changed', () => {
    const after = makeHandout((h) => {
      h.partA.courseObjectives = [
        { code: 'CO2', description: 'Evaluate quality attributes and trade-offs' },
        { code: 'CO3', description: 'Document an architecture' },
      ];
    });
    const s = section(compareHandouts(makeHandout(), after), 'courseObjectives');
    expect(s.rows.map((r) => [r.label, r.kind])).toEqual([
      ['CO1', 'removed'],
      ['CO2', 'changed'],
      ['CO3', 'added'],
    ]);
    expect(s.changed).toBe(3);
    const co1 = s.rows[0]!;
    expect(co1.before).toBe('Understand architecture styles');
    expect(co1.after).toBeNull();
    const co3 = s.rows[2]!;
    expect(co3.before).toBeNull();
    expect(co3.after).toBe('Document an architecture');
  });

  it('is deterministic when codes are renumbered', () => {
    const after = makeHandout((h) => {
      h.partA.courseObjectives = [
        { code: 'CO2', description: 'Understand architecture styles' },
        { code: 'CO3', description: 'Evaluate quality attributes' },
      ];
    });
    const a = compareHandouts(makeHandout(), after);
    const b = compareHandouts(makeHandout(), after);
    expect(a).toEqual(b);
    expect(section(a, 'courseObjectives').rows.map((r) => [r.label, r.kind])).toEqual([
      ['CO1', 'removed'],
      ['CO2', 'changed'],
      ['CO3', 'added'],
    ]);
  });

  it('session change produces a word diff with add and del tokens', () => {
    const after = makeHandout((h) => {
      h.partB.sessions[1]!.subTopics = 'layered; microservices';
    });
    const r = row(compareHandouts(makeHandout(), after), 'sessions', 'Session 2-3');
    expect(r.kind).toBe('changed');
    expect(r.before).toContain('pipes and filters');
    expect(r.words).toBeDefined();
    const ops = r.words!.map((w) => w.op);
    expect(ops).toContain('add');
    expect(ops).toContain('del');
    expect(r.words!.find((w) => w.op === 'add')!.text).toBe('microservices');
    expect(r.words!.find((w) => w.op === 'del')!.text).toBe('pipes and filters');
    // Reconstructing each side from the tokens gives back the plain text.
    const side = (skip: 'add' | 'del') =>
      r
        .words!.filter((w) => w.op !== skip)
        .map((w) => w.text)
        .join(' ');
    expect(side('add')).toBe(r.before);
    expect(side('del')).toBe(r.after);
  });

  it('session matching uses the session number, not position', () => {
    const after = makeHandout((h) => {
      h.partB.sessions = [
        { sessionNumber: '0', topicTitle: 'Orientation', subTopics: '', references: [] },
        ...h.partB.sessions,
      ];
    });
    const s = section(compareHandouts(makeHandout(), after), 'sessions');
    expect(s.rows.map((r) => [r.label, r.kind])).toEqual([
      ['Session 0', 'added'],
      ['Session 1', 'same'],
      ['Session 2-3', 'same'],
    ]);
  });

  it('evaluation weight change shows as changed', () => {
    const after = makeHandout((h) => {
      h.evaluation.components[0]!.subComponents[0]!.weight = 40;
      h.evaluation.components[1]!.subComponents[0]!.weight = 60;
    });
    const c = compareHandouts(makeHandout(), after);
    const quiz = row(c, 'evaluation', 'EC-1 · Quiz');
    expect(quiz.kind).toBe('changed');
    expect(quiz.before).toContain('30%');
    expect(quiz.after).toContain('40%');
    expect(quiz.words).toEqual(
      expect.arrayContaining([
        { op: 'del', text: '30%' },
        { op: 'add', text: '40%' },
      ]),
    );
    expect(section(c, 'evaluation').changed).toBe(2);
  });

  it('experiential learning on one side only → added / removed', () => {
    const withEl = makeHandout((h) => {
      h.experientialLearning = {
        overallObjective: '<p>Hands-on labs.</p>',
        overallScope: ['Unit testing'],
        components: [],
        labInfrastructure: [],
        experiments: [{ experimentNumber: '1.', title: 'First lab', moduleReference: 'M1' }],
      };
    });
    const added = section(compareHandouts(makeHandout(), withEl), 'experiential');
    expect(added.title).toBe('Experiential learning');
    expect(added.rows.length).toBeGreaterThan(0);
    expect(added.rows.every((r) => r.kind === 'added')).toBe(true);
    expect(added.rows.map((r) => r.label)).toEqual(['Objective', 'Scope', 'Experiment 1']);

    const removed = section(compareHandouts(withEl, makeHandout()), 'experiential');
    expect(removed.rows.every((r) => r.kind === 'removed')).toBe(true);
  });

  it('counts totals and size across sections', () => {
    const after = makeHandout((h) => {
      h.partA.courseTitle = 'Software Architecture';
    });
    const c = compareHandouts(makeHandout(), after);
    expect(c.changedRows).toBe(1);
    expect(c.size).toBe('small');
    expect(row(c, 'courseDetails', 'Course title').kind).toBe('changed');
  });

  it('shows the old importer’s placeholder in plain words', () => {
    const past = makeHandout((h) => {
      h.partA.textBooks = [
        { code: 'T1', citation: '(missing — placeholder generated by importer)' },
      ];
    });
    const c = compareHandouts(past, makeHandout());
    const t1 = c.sections.flatMap((s) => s.rows).find((r) => r.key.includes('T1'))!;
    expect(t1.before).toBe('Not found in the old handout file');
  });
});

describe('changeSize', () => {
  it('applies the documented thresholds', () => {
    expect(changeSize(0, 20)).toBe('none');
    expect(changeSize(0, 0)).toBe('none');
    expect(changeSize(1, 20)).toBe('small'); // 0.05
    expect(changeSize(2, 14)).toBe('small'); // 0.142…
    expect(changeSize(3, 20)).toBe('medium'); // 0.15 boundary
    expect(changeSize(7, 20)).toBe('medium'); // 0.35
    expect(changeSize(8, 20)).toBe('large'); // 0.4 boundary
    expect(changeSize(20, 20)).toBe('large');
  });

  it('has plain-language labels', () => {
    expect(CHANGE_SIZE_LABEL).toEqual({
      none: 'No changes',
      small: 'Small changes',
      medium: 'Some changes',
      large: 'Changed a lot',
    });
  });
});

describe('stripHtml', () => {
  it('decodes named and numeric entities', () => {
    expect(stripHtml('A &amp; B &lt;tag&gt; &quot;q&quot; it&#39;s')).toBe('A & B <tag> "q" it\'s');
    expect(stripHtml('&#65;&#x42;&#X43;')).toBe('ABC');
    expect(stripHtml('a&nbsp;&nbsp;b')).toBe('a b');
    // Single pass: double-escaped text stays escaped once.
    expect(stripHtml('&amp;lt;')).toBe('&lt;');
    // Unknown entities are left alone.
    expect(stripHtml('&bogus; x')).toBe('&bogus; x');
  });

  it('turns block boundaries into spaces and drops tags', () => {
    expect(stripHtml('<p>One</p><p>Two<br>Three</p><ul><li>Four</li><li>Five</li></ul>')).toBe(
      'One Two Three Four Five',
    );
    expect(stripHtml('<p><strong>Bold</strong>  and <a href="x">link</a></p>')).toBe(
      'Bold and link',
    );
    expect(stripHtml('   ')).toBe('');
  });
});

describe('diffWords long-text fallback', () => {
  it('falls back to one del + one add token when a side is very long', () => {
    const before = Array.from({ length: 5000 }, (_, i) => `b${i}`).join(' ');
    const after = Array.from({ length: 5000 }, (_, i) => `a${i}`).join(' ');
    const t0 = Date.now();
    const words = diffWords(before, after);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(words).toEqual([
      { op: 'del', text: before },
      { op: 'add', text: after },
    ]);
  });

  it('still diffs long texts finely when the change is small (common prefix/suffix trimmed)', () => {
    const base = Array.from({ length: 3000 }, (_, i) => `w${i}`);
    const changed = [...base];
    changed[1500] = 'CHANGED';
    const words = diffWords(base.join(' '), changed.join(' '));
    expect(words.map((w) => w.op)).toEqual(['eq', 'del', 'add', 'eq']);
    expect(words[1]).toEqual({ op: 'del', text: 'w1500' });
    expect(words[2]).toEqual({ op: 'add', text: 'CHANGED' });
  });

  it('long changed row through compareHandouts stays fast', () => {
    const long = (p: string) =>
      `<p>${Array.from({ length: 2000 }, (_, i) => `${p}${i}`).join(' ')}</p>`;
    const c = compareHandouts(
      makeHandout((h) => {
        h.partA.courseDescription = long('x');
      }),
      makeHandout((h) => {
        h.partA.courseDescription = long('y');
      }),
    );
    const r = row(c, 'courseDescription', 'Course description');
    expect(r.kind).toBe('changed');
    expect(r.words).toHaveLength(2);
  });
});

describe('HandoutCompareView (static render)', () => {
  it('renders sections, row kinds and hides unchanged rows by default', async () => {
    const React = await import('react');
    const { createElement } = React;
    // Vitest's esbuild uses the classic JSX runtime (tsconfig has
    // jsx: preserve for Next), which expects a global `React`.
    (globalThis as { React?: unknown }).React = React;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { HandoutCompareView } = await import('@/components/handout-compare-view');
    const after = makeHandout((h) => {
      h.partA.courseObjectives = [
        { code: 'CO2', description: 'Evaluate quality attributes and trade-offs' },
        { code: 'CO3', description: 'Document an architecture' },
      ];
    });
    const comparison = compareHandouts(makeHandout(), after);
    const render = (showUnchanged: boolean) =>
      renderToStaticMarkup(
        createElement(HandoutCompareView, {
          comparison,
          beforeLabel: '2024-25',
          afterLabel: '2025-26',
          showUnchanged,
        }),
      );
    const html = render(false);
    expect(html).toContain('data-testid="compare-view"');
    expect(html.match(/data-testid="compare-section"/g)).toHaveLength(comparison.sections.length);
    expect(html).toContain('data-kind="added"');
    expect(html).toContain('data-kind="removed"');
    expect(html).toContain('data-kind="changed"');
    expect(html).not.toContain('data-kind="same"');
    expect(html).toContain('3 changes');
    expect(html).toContain('No changes');
    expect(html).toMatch(/<ins[^>]*>.*trade-offs/);
    expect(render(true)).toContain('data-kind="same"');
  });
});
