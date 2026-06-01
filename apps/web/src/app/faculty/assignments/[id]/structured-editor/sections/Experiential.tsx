'use client';

import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import { RichTextSubEditor } from '../RichTextSubEditor';
import { BulletList } from '../chips/BulletList';

type ELValue = NonNullable<BitsHandoutV1['experientialLearning']>;
type Component = ELValue['components'][number];
type Experiment = ELValue['experiments'][number];

interface Props {
  value: BitsHandoutV1['experientialLearning'];
  onChange: (next: BitsHandoutV1['experientialLearning']) => void;
}

/**
 * Experiential Learning (FULL, 11d-b). Replaces `ExperientialMinimal`.
 *
 * The whole section is optional (faculty toggles on/off — theory courses
 * like `CC ZG501` legitimately have none). When on, faculty edits:
 *   - overallObjective: rich-text via the shared TipTap sub-editor.
 *   - overallScope: vertical bullet list (sentences-length items).
 *   - labInfrastructure: vertical bullet list (lab/modality descriptions).
 *   - components: repeating cards, six text fields each.
 *   - experiments: repeating rows with experimentNumber / title /
 *     moduleReference. experimentNumber is a string per the schema (corpus
 *     showed "6.", "8." with trailing periods) — keep as flexible text.
 */
export function Experiential({ value, onChange }: Props) {
  if (value === undefined) {
    return (
      <section
        aria-label="Experiential Learning"
        className="space-y-2"
        data-testid="bits-experiential"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Experiential Learning</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                components: [],
                overallObjective: '<p></p>',
                overallScope: [],
                labInfrastructure: [],
                experiments: [],
              })
            }
            data-testid="bits-experiential-toggle"
          >
            Add section
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Optional. Theory courses (e.g. <span className="font-mono">CC ZG501</span>) have no
          experiential section.
        </p>
      </section>
    );
  }

  const update = <K extends keyof ELValue>(key: K, next: ELValue[K]) =>
    onChange({ ...value, [key]: next });

  const updateComponent = (idx: number, next: Component) =>
    update(
      'components',
      value.components.map((c, i) => (i === idx ? next : c)),
    );
  const removeComponent = (idx: number) =>
    update(
      'components',
      value.components.filter((_, i) => i !== idx),
    );
  const addComponent = () =>
    update('components', [
      ...value.components,
      {
        name: '',
        objective: '',
        outcome: '',
        labInfrastructure: '',
        numberOfExercises: '',
        scope: '',
      },
    ]);

  const updateExperiment = (idx: number, next: Experiment) =>
    update(
      'experiments',
      value.experiments.map((e, i) => (i === idx ? next : e)),
    );
  const removeExperiment = (idx: number) =>
    update(
      'experiments',
      value.experiments.filter((_, i) => i !== idx),
    );
  const addExperiment = () =>
    update('experiments', [
      ...value.experiments,
      {
        experimentNumber: String(value.experiments.length + 1),
        title: '',
        moduleReference: '',
      },
    ]);

  return (
    <section
      aria-label="Experiential Learning"
      className="space-y-3"
      data-testid="bits-experiential"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Experiential Learning</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(undefined)}
          data-testid="bits-experiential-toggle"
        >
          Remove section
        </Button>
      </div>

      <div className="space-y-1">
        <Label>Overall objective</Label>
        <RichTextSubEditor
          value={value.overallObjective}
          onChange={(html) => update('overallObjective', html)}
        />
      </div>

      <BulletList
        label="Overall scope"
        placeholder="One scope item…"
        value={value.overallScope}
        onChange={(arr) => update('overallScope', arr)}
        testIdPrefix="bits-exp-scope"
      />

      <BulletList
        label="Lab infrastructure"
        placeholder="One lab/modality…"
        value={value.labInfrastructure}
        onChange={(arr) => update('labInfrastructure', arr)}
        testIdPrefix="bits-exp-labinfra"
      />

      <div className="space-y-2">
        <Label>Components</Label>
        {value.components.length === 0 && (
          <p className="text-muted-foreground text-xs italic">No components yet.</p>
        )}
        {value.components.map((c, idx) => (
          <div key={idx} className="grid gap-2 rounded-md border p-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label className="text-xs">Name</Label>
                <input
                  value={c.name}
                  onChange={(e) => updateComponent(idx, { ...c, name: e.target.value })}
                  className="bg-background rounded-md border px-2 py-1 text-sm"
                  data-testid={`bits-exp-comp-name-${idx}`}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs"># of exercises</Label>
                <input
                  value={c.numberOfExercises}
                  onChange={(e) =>
                    updateComponent(idx, { ...c, numberOfExercises: e.target.value })
                  }
                  className="bg-background rounded-md border px-2 py-1 text-sm"
                  placeholder='e.g. 4 or "As per"'
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Objective</Label>
              <textarea
                value={c.objective}
                onChange={(e) => updateComponent(idx, { ...c, objective: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                rows={2}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Outcome</Label>
              <textarea
                value={c.outcome}
                onChange={(e) => updateComponent(idx, { ...c, outcome: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                rows={2}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Lab infrastructure</Label>
              <textarea
                value={c.labInfrastructure}
                onChange={(e) => updateComponent(idx, { ...c, labInfrastructure: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                rows={2}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Scope</Label>
              <textarea
                value={c.scope}
                onChange={(e) => updateComponent(idx, { ...c, scope: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                rows={2}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeComponent(idx)}
              aria-label={`Remove component ${c.name || idx + 1}`}
              className="w-fit"
            >
              Remove component
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addComponent}
          data-testid="bits-exp-comp-add"
          className="w-fit"
        >
          + Add component
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Experiments / Practice tutorials</Label>
        {value.experiments.length === 0 && (
          <p className="text-muted-foreground text-xs italic">No experiments yet.</p>
        )}
        {value.experiments.map((e, idx) => (
          <div
            key={idx}
            className="grid grid-cols-[80px_1fr_auto] items-start gap-2 rounded-md border p-2"
          >
            <div className="grid gap-1">
              {idx === 0 && <Label className="text-xs">#</Label>}
              <input
                value={e.experimentNumber}
                onChange={(ev) =>
                  updateExperiment(idx, { ...e, experimentNumber: ev.target.value })
                }
                className="bg-background rounded-md border px-2 py-1 font-mono text-sm"
                placeholder='e.g. 1 or "6."'
                data-testid={`bits-exp-exper-num-${idx}`}
              />
            </div>
            <div className="grid gap-1">
              {idx === 0 && <Label className="text-xs">Title</Label>}
              <input
                value={e.title}
                onChange={(ev) => updateExperiment(idx, { ...e, title: ev.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                data-testid={`bits-exp-exper-title-${idx}`}
              />
              <Label className="mt-1 text-xs">Module reference</Label>
              <textarea
                value={e.moduleReference}
                onChange={(ev) => updateExperiment(idx, { ...e, moduleReference: ev.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                rows={2}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeExperiment(idx)}
              className="mt-5"
              aria-label={`Remove experiment ${idx + 1}`}
            >
              ×
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addExperiment}
          data-testid="bits-exp-exper-add"
          className="w-fit"
        >
          + Add experiment
        </Button>
      </div>
    </section>
  );
}
