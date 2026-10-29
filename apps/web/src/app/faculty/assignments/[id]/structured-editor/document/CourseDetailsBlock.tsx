'use client';

import { useEffect, useState } from 'react';
import type { BitsHandoutV1 } from '@hmp/db';
import { InlineField } from './InlineField';

type PartA = BitsHandoutV1['partA'];

interface Props {
  value: PartA;
  semester: string;
  onChange: (next: PartA) => void;
}

const toList = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const toInt = (s: string): number | undefined => (s === '' ? undefined : Number(s));

/**
 * List-valued cells (course numbers, instructors) keep the faculty member's own
 * typing ("CS ZG501, ") while they type, and commit the parsed list on every
 * keystroke — so a trailing comma never disappears under the cursor.
 */
function useListText(list: string[], sep: string): [string, (s: string) => void] {
  const [text, setText] = useState(list.join(sep));
  // Only re-sync when the list changes from outside (AI draft, reset): the key
  // is the joined list, so the faculty member's own in-progress text is kept.
  const key = list.join('|');
  useEffect(() => {
    setText((current) => (toList(current).join('|') !== key ? list.join(sep) : current));
  }, [key, list, sep]);
  return [text, setText];
}

/**
 * Course details table (handout-editor-ux step 1): the same rows, order and
 * labels as the renderer's `renderCourseDetails()`, with every value editable in
 * place. Optional rows the renderer hides when empty (Credit Units, Version No)
 * are always shown here so faculty can fill them; empty ones are skipped in the
 * Preview, exactly as in the published handout.
 */
export function CourseDetailsBlock({ value, semester, onChange }: Props) {
  const update = <K extends keyof PartA>(key: K, next: PartA[K]) =>
    onChange({ ...value, [key]: next });
  const cm = value.creditModel;
  const setHours = (key: 'classroomHours' | 'tutorialHours' | 'preparationHours', s: string) =>
    update('creditModel', { ...cm, [key]: toInt(s) });

  const [numbersText, setNumbersText] = useListText(value.courseNumbers, ' / ');
  const [instructorsText, setInstructorsText] = useListText(value.instructors, ', ');

  const numbersProblem =
    value.courseNumbers.length === 0 ? 'Add the course number, e.g. CS ZG501.' : null;
  const titleProblem = value.courseTitle.trim() === '' ? 'The course needs a title.' : null;
  const instructorsProblem = value.instructors.length === 0 ? 'Add at least one instructor.' : null;

  return (
    <table className="bits-handout-coursedetails" data-testid="bits-course-details">
      <tbody>
        <tr>
          <th>Course No(s)</th>
          <td>
            <InlineField
              value={numbersText}
              onChange={(s) => {
                setNumbersText(s);
                update('courseNumbers', toList(s.replace(/\//g, ',')));
              }}
              placeholder="Click to add course number(s), e.g. CS ZG501"
              label="Course numbers"
              testId="bits-course-numbers"
              problem={numbersProblem}
            />
            <span className="hed-hint">
              For a cross-listed course, list every number, e.g. MBA ZC417 / PDBA ZC417
            </span>
          </td>
        </tr>
        <tr>
          <th>Course Title</th>
          <td>
            <InlineField
              value={value.courseTitle}
              onChange={(s) => update('courseTitle', s)}
              placeholder="Click to add course title"
              label="Course title"
              testId="bits-course-title"
              problem={titleProblem}
            />
          </td>
        </tr>
        <tr>
          <th>Credit Units</th>
          <td>
            <InlineField
              value={value.creditUnits == null ? '' : String(value.creditUnits)}
              onChange={(s) => update('creditUnits', toInt(s))}
              placeholder="Click to add credit units"
              label="Credit units"
              testId="bits-credit-units"
              numeric
            />
          </td>
        </tr>
        <tr>
          <th>Credit Model</th>
          <td>
            <InlineField
              value={cm.description}
              onChange={(s) => update('creditModel', { ...cm, description: s })}
              placeholder='Click to add credit model, e.g. "3-1-1"'
              label="Credit model"
              testId="bits-credit-model"
            />
            <span className="hed-hours">
              Classroom{' '}
              <InlineField
                value={cm.classroomHours == null ? '' : String(cm.classroomHours)}
                onChange={(s) => setHours('classroomHours', s)}
                placeholder="–"
                label="Classroom hours"
                numeric
                widthCh={4}
              />
              h · Tutorial{' '}
              <InlineField
                value={cm.tutorialHours == null ? '' : String(cm.tutorialHours)}
                onChange={(s) => setHours('tutorialHours', s)}
                placeholder="–"
                label="Tutorial hours"
                numeric
                widthCh={4}
              />
              h · Preparation{' '}
              <InlineField
                value={cm.preparationHours == null ? '' : String(cm.preparationHours)}
                onChange={(s) => setHours('preparationHours', s)}
                placeholder="–"
                label="Preparation hours"
                numeric
                widthCh={4}
              />
              h{' '}
              <span className="hed-hint" style={{ display: 'inline' }}>
                (optional)
              </span>
            </span>
          </td>
        </tr>
        <tr>
          <th>Instructor(s)</th>
          <td>
            <InlineField
              value={instructorsText}
              onChange={(s) => {
                setInstructorsText(s);
                update('instructors', toList(s));
              }}
              placeholder="Click to add instructors, e.g. Dr. A. Rao, Dr. B. Sen"
              label="Instructors"
              testId="bits-instructors"
              multiline
              problem={instructorsProblem}
            />
            <span className="hed-hint">
              The first name listed is printed as Instructor-in-Charge.
            </span>
          </td>
        </tr>
        <tr>
          <th>Semester</th>
          <td className="hed-readonly">{semester}</td>
        </tr>
        <tr>
          <th>Version No</th>
          <td>
            <InlineField
              value={value.versionNo == null ? '' : String(value.versionNo)}
              onChange={(s) => update('versionNo', toInt(s))}
              placeholder="Click to add version number"
              label="Version number"
              testId="bits-version-no"
              numeric
            />
          </td>
        </tr>
        <tr>
          <th>Date</th>
          <td>
            <InlineField
              value={value.date}
              onChange={(s) => update('date', s)}
              placeholder="Click to add date, e.g. 05 Dec 2026"
              label="Date"
              testId="bits-date"
            />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
