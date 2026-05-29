'use client';

import { Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';

interface Props {
  value: BitsHandoutV1['partA'];
  onChange: (next: BitsHandoutV1['partA']) => void;
}

function csvToList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Part A — Course Identification metadata. The repeating arrays
 * (courseObjectives, textBooks, referenceBooks, learningOutcomes) live in
 * their own `CodedListSection` instances below this — Part A here is the
 * scalar/metadata block (course title, course numbers, credit model,
 * instructors, version, date, course description).
 *
 * Array inputs (`courseNumbers`, `instructors`) are comma-separated text
 * for simplicity in 11d-a; chip-style editing is a 11d-b refinement.
 */
export function PartAMetadata({ value, onChange }: Props) {
  const update = <K extends keyof BitsHandoutV1['partA']>(
    key: K,
    next: BitsHandoutV1['partA'][K],
  ) => onChange({ ...value, [key]: next });

  return (
    <section aria-label="Part A — Course Identification" className="space-y-3">
      <h3 className="text-base font-semibold">Part A — Course Identification</h3>

      <div className="grid gap-1">
        <Label htmlFor="bits-course-title">Course title *</Label>
        <input
          id="bits-course-title"
          data-testid="bits-course-title"
          value={value.courseTitle}
          onChange={(e) => update('courseTitle', e.target.value)}
          className="bg-background rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <div className="grid gap-1">
        <Label htmlFor="bits-course-numbers">
          Course number(s) * (comma-separated for cross-listed)
        </Label>
        <input
          id="bits-course-numbers"
          data-testid="bits-course-numbers"
          value={value.courseNumbers.join(', ')}
          onChange={(e) => update('courseNumbers', csvToList(e.target.value))}
          placeholder="e.g. AE ZG631, AEL ZG631"
          className="bg-background rounded-md border px-2 py-1 font-mono text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="bits-credit-units">Credit units (optional)</Label>
          <input
            id="bits-credit-units"
            type="number"
            value={value.creditUnits ?? ''}
            onChange={(e) =>
              update('creditUnits', e.target.value === '' ? undefined : Number(e.target.value))
            }
            className="bg-background rounded-md border px-2 py-1 text-sm"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="bits-credit-model">Credit model * (e.g. "3-1-1")</Label>
          <input
            id="bits-credit-model"
            data-testid="bits-credit-model"
            value={value.creditModel.description}
            onChange={(e) =>
              update('creditModel', { ...value.creditModel, description: e.target.value })
            }
            className="bg-background rounded-md border px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="bits-instructors">Instructors * (comma-separated)</Label>
        <input
          id="bits-instructors"
          data-testid="bits-instructors"
          value={value.instructors.join(', ')}
          onChange={(e) => update('instructors', csvToList(e.target.value))}
          className="bg-background rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="bits-version-no">Version no (optional)</Label>
          <input
            id="bits-version-no"
            type="number"
            value={value.versionNo ?? ''}
            onChange={(e) =>
              update('versionNo', e.target.value === '' ? undefined : Number(e.target.value))
            }
            className="bg-background rounded-md border px-2 py-1 text-sm"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="bits-date">Date *</Label>
          <input
            id="bits-date"
            data-testid="bits-date"
            value={value.date}
            onChange={(e) => update('date', e.target.value)}
            placeholder="e.g. 6 Jan 2025"
            className="bg-background rounded-md border px-2 py-1 text-sm"
          />
        </div>
      </div>
    </section>
  );
}
