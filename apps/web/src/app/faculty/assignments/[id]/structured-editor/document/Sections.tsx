'use client';

import type { BitsHandoutV1 } from '@hmp/db';
import { RichTextSubEditor } from '../RichTextSubEditor';
import { evaluationTotalWeight } from '../sections/evaluation-validity';
import { DocTable, renumberCodes, type DocColumn } from './DocTable';
import { InlineField } from './InlineField';
import { ListField } from './ListField';

type Data = BitsHandoutV1;
type PartA = Data['partA'];
type Session = Data['partB']['sessions'][number];
type EL = NonNullable<Data['experientialLearning']>;
type EvalComponent = Data['evaluation']['components'][number];
type SubComponent = EvalComponent['subComponents'][number];

/** Numbered section heading, printed the way the renderer prints `<h2>`. */
export function SectionHeading({ n, title }: { n: number; title: string }) {
  return (
    <h2>
      {n}. {title}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Course description (+ optional laboratory component)
// ---------------------------------------------------------------------------

export function CourseDescriptionBody({
  value,
  onChange,
}: {
  value: PartA;
  onChange: (next: PartA) => void;
}) {
  return (
    <>
      <RichTextSubEditor
        variant="page"
        minHeightPx={48}
        value={value.courseDescription}
        onChange={(html) => onChange({ ...value, courseDescription: html })}
        placeholder="Click to describe the course: what it covers and who it is for."
        label="Course description"
        testId="bits-course-description"
      />
      {value.laboratoryComponent !== undefined ? (
        <>
          <h3 className="hed-h3-row">
            Laboratory Component
            <button
              type="button"
              className="hed-link"
              onClick={() => onChange({ ...value, laboratoryComponent: undefined })}
            >
              Remove
            </button>
          </h3>
          <RichTextSubEditor
            variant="page"
            minHeightPx={40}
            value={value.laboratoryComponent}
            onChange={(html) => onChange({ ...value, laboratoryComponent: html })}
            placeholder="Click to describe the laboratory component."
            label="Laboratory component"
          />
        </>
      ) : (
        <button
          type="button"
          className="hed-add"
          onClick={() => onChange({ ...value, laboratoryComponent: '<p></p>' })}
          data-testid="bits-add-lab"
        >
          + Add a laboratory component
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Coded tables: objectives, outcomes, text books, reference material
// ---------------------------------------------------------------------------

interface CodedProps<T extends { code: string }> {
  rows: T[];
  onChange: (next: T[]) => void;
  prefix: string;
  codeHeader: string;
  textHeader: string;
  field: 'description' | 'citation';
  className: string;
  placeholder: string;
  addLabel: string;
  emptyText: string;
  testPrefix: string;
  minRows?: number;
  problem?: string | null;
}

export function CodedTable<T extends { code: string }>({
  rows,
  onChange,
  prefix,
  codeHeader,
  textHeader,
  field,
  className,
  placeholder,
  addLabel,
  emptyText,
  testPrefix,
  minRows,
  problem,
}: CodedProps<T>) {
  const columns: DocColumn<T>[] = [
    { header: codeHeader, cell: (r) => <span className="hed-code">{r.code}</span> },
    {
      header: textHeader,
      cell: (r, i, update) => (
        <InlineField
          value={String((r as Record<string, unknown>)[field] ?? '')}
          onChange={(s) => update({ ...r, [field]: s })}
          placeholder={placeholder}
          label={`${r.code} ${textHeader.toLowerCase()}`}
          testId={`bits-${testPrefix}-text-${i}`}
          multiline
        />
      ),
    },
  ];
  return (
    <DocTable<T>
      className={className}
      columns={columns}
      rows={rows}
      onChange={onChange}
      makeRow={(so) => ({ code: `${prefix}${so.length + 1}`, [field]: '' }) as unknown as T}
      renumber={renumberCodes<T>(prefix)}
      minRows={minRows}
      addLabel={addLabel}
      emptyText={emptyText}
      testId={`bits-${testPrefix}`}
      problem={problem}
      rowLabel={(r) => r.code}
    />
  );
}

// ---------------------------------------------------------------------------
// Course plan (sessions)
// ---------------------------------------------------------------------------

const subTopicsToList = (s: string): string[] =>
  s
    .split(/;\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

export function CoursePlanTable({
  sessions,
  onChange,
}: {
  sessions: Session[];
  onChange: (next: Session[]) => void;
}) {
  const columns: DocColumn<Session>[] = [
    {
      header: 'Session',
      cell: (r, i, update) => (
        <InlineField
          value={r.sessionNumber}
          onChange={(s) => update({ ...r, sessionNumber: s })}
          placeholder="e.g. 1 or 5-6"
          label="Session number"
          testId={`bits-partb-num-${i}`}
          problem={r.sessionNumber.trim() === '' ? 'Needs a session number.' : null}
        />
      ),
    },
    {
      header: 'Topic',
      cell: (r, i, update) => (
        <InlineField
          value={r.topicTitle}
          onChange={(s) => update({ ...r, topicTitle: s })}
          placeholder="Click to add the topic"
          label={`Session ${r.sessionNumber} topic`}
          testId={`bits-partb-title-${i}`}
          multiline
        />
      ),
    },
    {
      header: 'Sub-topics',
      cell: (r, i, update) => (
        <ListField
          list={subTopicsToList(r.subTopics)}
          onChange={(l) => update({ ...r, subTopics: l.join('; ') })}
          mode="lines"
          placeholder="One sub-topic per line"
          label={`Session ${r.sessionNumber} sub-topics`}
          testId={`bits-partb-subtopics-${i}`}
        />
      ),
    },
    {
      header: 'References',
      cell: (r, i, update) => (
        <ListField
          list={r.references}
          onChange={(l) => update({ ...r, references: l })}
          mode="commas"
          placeholder="e.g. T1 Ch 4, R2"
          label={`Session ${r.sessionNumber} references`}
          testId={`bits-partb-refs-${i}`}
        />
      ),
    },
  ];
  return (
    <DocTable<Session>
      className="bits-handout-courseplan"
      columns={columns}
      rows={sessions}
      onChange={onChange}
      makeRow={(so) => ({
        sessionNumber: String(so.length + 1),
        topicTitle: '',
        subTopics: '',
        references: [],
      })}
      minRows={1}
      addLabel="Add session"
      emptyText="No sessions yet."
      testId="bits-partb"
      rowLabel={(r) => `session ${r.sessionNumber}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Experiential learning (optional section)
// ---------------------------------------------------------------------------

const EMPTY_EL: EL = {
  components: [],
  overallObjective: '<p></p>',
  overallScope: [],
  labInfrastructure: [],
  experiments: [],
};

export function ExperientialBody({
  value,
  onChange,
}: {
  value: Data['experientialLearning'];
  onChange: (next: Data['experientialLearning']) => void;
}) {
  if (value === undefined) {
    return (
      <div data-testid="bits-experiential">
        <p className="hed-muted">
          Optional — most theory courses have none.{' '}
          <button
            type="button"
            className="hed-add"
            onClick={() => onChange(EMPTY_EL)}
            data-testid="bits-experiential-toggle"
          >
            + Add experiential learning
          </button>
        </p>
      </div>
    );
  }
  const set = <K extends keyof EL>(k: K, v: EL[K]) => onChange({ ...value, [k]: v });
  const text = (
    v: string,
    on: (s: string) => void,
    label: string,
    placeholder = 'Click to add',
  ) => <InlineField value={v} onChange={on} placeholder={placeholder} label={label} multiline />;
  return (
    <div data-testid="bits-experiential">
      <h3 className="hed-h3-row">
        Objective
        <button
          type="button"
          className="hed-link"
          onClick={() => {
            if (window.confirm('Remove the whole experiential learning section?'))
              onChange(undefined);
          }}
        >
          Remove this section
        </button>
      </h3>
      <RichTextSubEditor
        variant="page"
        minHeightPx={36}
        value={value.overallObjective}
        onChange={(html) => set('overallObjective', html)}
        placeholder="Click to state the objective of the experiential component."
        label="Experiential learning objective"
      />
      <h3>Scope</h3>
      <ListField
        list={value.overallScope}
        onChange={(l) => set('overallScope', l)}
        mode="lines"
        placeholder="One scope item per line"
        label="Experiential scope"
      />
      <h3>Components</h3>
      <DocTable<EL['components'][number]>
        className="bits-handout-expcomponents"
        columns={[
          {
            header: 'Name',
            cell: (r, _i, u) => text(r.name, (s) => u({ ...r, name: s }), 'Component name'),
          },
          {
            header: 'Objective',
            cell: (r, _i, u) =>
              text(r.objective, (s) => u({ ...r, objective: s }), 'Component objective'),
          },
          {
            header: 'Outcome',
            cell: (r, _i, u) =>
              text(r.outcome, (s) => u({ ...r, outcome: s }), 'Component outcome'),
          },
          {
            header: 'Lab Infrastructure',
            cell: (r, _i, u) =>
              text(
                r.labInfrastructure,
                (s) => u({ ...r, labInfrastructure: s }),
                'Component lab infrastructure',
              ),
          },
          {
            header: '# Exercises',
            cell: (r, _i, u) =>
              text(
                r.numberOfExercises,
                (s) => u({ ...r, numberOfExercises: s }),
                'Number of exercises',
                '–',
              ),
          },
          {
            header: 'Scope',
            cell: (r, _i, u) => text(r.scope, (s) => u({ ...r, scope: s }), 'Component scope'),
          },
        ]}
        rows={value.components}
        onChange={(rows) => set('components', rows)}
        makeRow={() => ({
          name: '',
          objective: '',
          outcome: '',
          labInfrastructure: '',
          numberOfExercises: '',
          scope: '',
        })}
        addLabel="Add component"
        emptyText="No components yet."
        testId="bits-exp-components"
      />
      <h3>Lab Infrastructure</h3>
      <ListField
        list={value.labInfrastructure}
        onChange={(l) => set('labInfrastructure', l)}
        mode="lines"
        placeholder="One item per line"
        label="Lab infrastructure"
      />
      <h3>List of Experiments</h3>
      <DocTable<EL['experiments'][number]>
        className="bits-handout-experiments"
        columns={[
          {
            header: '#',
            cell: (r, _i, u) =>
              text(
                r.experimentNumber,
                (s) => u({ ...r, experimentNumber: s }),
                'Experiment number',
                '#',
              ),
          },
          {
            header: 'Title',
            cell: (r, _i, u) => text(r.title, (s) => u({ ...r, title: s }), 'Experiment title'),
          },
          {
            header: 'Module Reference',
            cell: (r, _i, u) =>
              text(r.moduleReference, (s) => u({ ...r, moduleReference: s }), 'Module reference'),
          },
        ]}
        rows={value.experiments}
        onChange={(rows) => set('experiments', rows)}
        makeRow={(so) => ({
          experimentNumber: String(so.length + 1),
          title: '',
          moduleReference: '',
        })}
        addLabel="Add experiment"
        emptyText="No experiments yet."
        testId="bits-exp-experiments"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evaluation scheme
// ---------------------------------------------------------------------------

interface FlatRow {
  ec: number;
  sc: number;
  first: boolean;
  ecNumber: string;
  sub: SubComponent;
}

const emptySub = (): SubComponent => ({ name: '', type: '', weight: 0, duration: '' });

export function EvaluationBody({
  value,
  onChange,
}: {
  value: Data['evaluation'];
  onChange: (next: Data['evaluation']) => void;
}) {
  const total = evaluationTotalWeight(value);
  const ok = total === 100;
  const flat: FlatRow[] = value.components.flatMap((c, ec) =>
    c.subComponents.map((sub, sc) => ({ ec, sc, first: sc === 0, ecNumber: c.ecNumber, sub })),
  );

  const setComponents = (components: EvalComponent[]) => onChange({ ...value, components });
  const updateSub = (row: FlatRow, sub: SubComponent) =>
    setComponents(
      value.components.map((c, i) =>
        i === row.ec
          ? { ...c, subComponents: c.subComponents.map((s, j) => (j === row.sc ? sub : s)) }
          : c,
      ),
    );
  const updateEcNumber = (ec: number, ecNumber: string) =>
    setComponents(value.components.map((c, i) => (i === ec ? { ...c, ecNumber } : c)));

  // DocTable works on a flat list; translate its add/delete back to the nested shape.
  const onFlatChange = (next: FlatRow[]) => {
    if (next.length < flat.length) {
      const kept = new Set(next.map((r) => `${r.ec}:${r.sc}`));
      const components = value.components
        .map((c, ec) => ({
          ...c,
          subComponents: c.subComponents.filter((_, sc) => kept.has(`${ec}:${sc}`)),
        }))
        .filter((c) => c.subComponents.length > 0)
        .map((c, i) => ({
          ...c,
          ecNumber: /^EC-\d+$/.test(c.ecNumber) ? `EC-${i + 1}` : c.ecNumber,
        }));
      setComponents(components);
    }
  };

  const addRow = () => {
    if (value.components.length === 0) {
      setComponents([{ ecNumber: 'EC-1', subComponents: [emptySub()] }]);
      return;
    }
    const last = value.components.length - 1;
    setComponents(
      value.components.map((c, i) =>
        i === last ? { ...c, subComponents: [...c.subComponents, emptySub()] } : c,
      ),
    );
  };
  const addEc = () =>
    setComponents([
      ...value.components,
      { ecNumber: `EC-${value.components.length + 1}`, subComponents: [emptySub()] },
    ]);

  const cellText = (
    v: string,
    on: (s: string) => void,
    label: string,
    placeholder: string,
    testId?: string,
  ) => (
    <InlineField
      value={v}
      onChange={on}
      placeholder={placeholder}
      label={label}
      testId={testId}
      multiline
    />
  );

  return (
    <div data-testid="bits-eval">
      <p>
        <em>
          <InlineField
            value={value.legend}
            onChange={(legend) => onChange({ ...value, legend })}
            placeholder="Click to add a legend, e.g. EC = Evaluation Component"
            label="Evaluation legend"
            multiline
          />
        </em>
      </p>
      <div className="hed-eval-table">
        <DocTable<FlatRow>
          className="bits-handout-evaluation"
          columns={[
            {
              header: 'EC',
              cell: (r) =>
                r.first ? (
                  <InlineField
                    value={r.ecNumber}
                    onChange={(s) => updateEcNumber(r.ec, s)}
                    placeholder="EC-1"
                    label="Evaluation component number"
                    testId={`bits-eval-ec-${r.ec}`}
                  />
                ) : null,
            },
            {
              header: 'Name',
              cell: (r) =>
                cellText(
                  r.sub.name,
                  (s) => updateSub(r, { ...r.sub, name: s }),
                  'Component name',
                  'e.g. Quiz',
                  `bits-eval-name-${r.ec}-${r.sc}`,
                ),
            },
            {
              header: 'Type',
              cell: (r) =>
                cellText(
                  r.sub.type,
                  (s) => updateSub(r, { ...r.sub, type: s }),
                  'Component type',
                  'e.g. Open book',
                ),
            },
            {
              header: 'Weight',
              cell: (r) => (
                <span className="hed-weight">
                  <InlineField
                    value={String(r.sub.weight)}
                    onChange={(s) =>
                      updateSub(r, { ...r.sub, weight: s === '' ? 0 : Math.min(100, Number(s)) })
                    }
                    placeholder="0"
                    label={`Weight of ${r.sub.name || 'this component'}`}
                    testId={`bits-eval-weight-${r.ec}-${r.sc}`}
                    numeric
                    widthCh={4}
                  />
                  %
                </span>
              ),
            },
            {
              header: 'Duration',
              cell: (r) =>
                cellText(
                  r.sub.duration,
                  (s) => updateSub(r, { ...r.sub, duration: s }),
                  'Duration',
                  'e.g. 2 hours',
                ),
            },
            {
              header: 'Scheduled',
              cell: (r) =>
                cellText(
                  r.sub.scheduledAt ?? '',
                  (s) => updateSub(r, { ...r.sub, scheduledAt: s }),
                  'Scheduled',
                  'e.g. 21 Sep 2026 (AN)',
                ),
            },
          ]}
          rows={flat}
          onChange={onFlatChange}
          addLabel="Add row"
          emptyText="No evaluation components yet."
          testId="bits-eval-table"
          rowLabel={(r) => `${r.ecNumber} ${r.sub.name || 'row'}`}
          footer={
            <>
              <button
                type="button"
                className="hed-add"
                onClick={addEc}
                data-testid="bits-eval-add-ec"
              >
                + Add evaluation component (EC)
              </button>
              <span
                className={ok ? 'hed-total hed-total-ok' : 'hed-total hed-total-bad'}
                data-testid="bits-eval-total"
                role="status"
                aria-live="polite"
              >
                {ok
                  ? `Total ${total}% ✓`
                  : `Total ${total}% — ${total < 100 ? `${100 - total}% short` : `${total - 100}% over`}; weights must add up to 100%`}
              </span>
            </>
          }
          addRowOverride={addRow}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Important notes & links
// ---------------------------------------------------------------------------

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ImportantNotesBody({
  evaluation,
  links,
  onEvaluation,
  onLinks,
}: {
  evaluation: Data['evaluation'];
  links: Data['importantLinks'];
  onEvaluation: (next: Data['evaluation']) => void;
  onLinks: (next: Data['importantLinks']) => void;
}) {
  const urlProblem = looksLikeUrl(links.elearnPortalUrl)
    ? null
    : 'Enter the full address, starting with https://';
  return (
    <>
      <h3>Syllabus for Mid-Semester Test</h3>
      <RichTextSubEditor
        variant="page"
        minHeightPx={28}
        value={evaluation.midSemSyllabus}
        onChange={(html) => onEvaluation({ ...evaluation, midSemSyllabus: html })}
        placeholder="Optional — e.g. Sessions 1 to 8"
        label="Mid-semester syllabus"
      />
      <h3>Syllabus for Comprehensive Examination</h3>
      <RichTextSubEditor
        variant="page"
        minHeightPx={28}
        value={evaluation.compreSyllabus}
        onChange={(html) => onEvaluation({ ...evaluation, compreSyllabus: html })}
        placeholder="Optional — e.g. All sessions"
        label="Comprehensive syllabus"
      />
      <h3>Important Links</h3>
      <p>
        eLearn Portal:{' '}
        <InlineField
          value={links.elearnPortalUrl}
          onChange={(s) => onLinks({ ...links, elearnPortalUrl: s.trim() })}
          placeholder="https://elearn.bits-pilani.ac.in"
          label="eLearn portal address"
          testId="bits-elearn-url"
          problem={urlProblem}
        />
      </p>
      <InlineField
        value={links.elearnPortalNote}
        onChange={(s) => onLinks({ ...links, elearnPortalNote: s })}
        placeholder="Optional note about the eLearn portal"
        label="eLearn portal note"
        multiline
      />
      <h3>Contact Sessions</h3>
      <InlineField
        value={links.contactSessionsNote}
        onChange={(s) => onLinks({ ...links, contactSessionsNote: s })}
        placeholder="Click to add a note about contact sessions"
        label="Contact sessions note"
        multiline
      />
      <h3>Additional Notes</h3>
      <RichTextSubEditor
        variant="page"
        minHeightPx={28}
        value={evaluation.notes}
        onChange={(html) => onEvaluation({ ...evaluation, notes: html })}
        placeholder="Optional"
        label="Additional notes"
      />
    </>
  );
}
