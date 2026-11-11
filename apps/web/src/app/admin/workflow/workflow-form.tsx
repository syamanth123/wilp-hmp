'use client';

import { useState, useTransition } from 'react';
import { Button, Input, Label } from '@hmp/ui';
import { updateSwitchesAction, updateWorkflowAction } from './actions';

type Config = {
  hogReviewSla: number;
  pcReviewSla: number;
  facultySubmitSla: number;
  hogFinalSla: number;
  offCampusMaxCourses: number;
  smeReviewSla: number;
  dueAllocationDays: number;
  dueDraftDays: number;
  dueSmeDays: number;
  duePcDays: number;
  dueHogFinalDays: number;
  duePublishDays: number;
};

function Msg({ msg }: { msg: { type: 'error' | 'ok'; text: string } | null }) {
  if (!msg) return null;
  return (
    <span
      className={'ml-3 text-sm ' + (msg.type === 'error' ? 'text-destructive' : 'text-emerald-600')}
    >
      {msg.text}
    </span>
  );
}

export function WorkflowConfigForm({ config }: { config: Config }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: 'error' | 'ok'; text: string } | null>(null);

  return (
    <form
      action={(fd) => {
        setMsg(null);
        startTransition(async () => {
          const res = await updateWorkflowAction(fd);
          if (res?.error) setMsg({ type: 'error', text: res.error });
          else setMsg({ type: 'ok', text: 'Saved' });
        });
      }}
      className="space-y-5"
      data-testid="workflow-form"
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">
          Due dates — days before the semester starts
        </legend>
        <p className="text-muted-foreground text-xs">
          Each step&apos;s due date. A request that starts late (or is sent back) gets at least the
          time allowed below, so it isn&apos;t overdue on day one. The IC or the request&apos;s HOG
          can change a date on one request.
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field
            name="dueAllocationDays"
            label="Allocation"
            defaultValue={config.dueAllocationDays}
            min={0}
          />
          <Field
            name="dueDraftDays"
            label="Faculty draft"
            defaultValue={config.dueDraftDays}
            min={0}
          />
          <Field name="dueSmeDays" label="SME review" defaultValue={config.dueSmeDays} min={0} />
          <Field name="duePcDays" label="PC review" defaultValue={config.duePcDays} min={0} />
          <Field
            name="dueHogFinalDays"
            label="HOG final approval"
            defaultValue={config.dueHogFinalDays}
            min={0}
          />
          <Field
            name="duePublishDays"
            label="Publish"
            defaultValue={config.duePublishDays}
            min={-60}
          />
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Time allowed for each step (hours)</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field name="hogReviewSla" label="HOG allocation" defaultValue={config.hogReviewSla} />
          <Field
            name="facultySubmitSla"
            label="Faculty writing"
            defaultValue={config.facultySubmitSla}
          />
          <Field name="smeReviewSla" label="SME review" defaultValue={config.smeReviewSla} />
          <Field name="pcReviewSla" label="PC review" defaultValue={config.pcReviewSla} />
          <Field name="hogFinalSla" label="HOG final approval" defaultValue={config.hogFinalSla} />
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Allocation</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field
            name="offCampusMaxCourses"
            label="Off-campus max courses / sem"
            defaultValue={config.offCampusMaxCourses}
          />
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Msg msg={msg} />
      </div>
    </form>
  );
}

export function SwitchesForm({
  escalationOn,
  escalationDays,
  autoPublish,
  taxilaOn,
}: {
  escalationOn: boolean;
  escalationDays: number;
  autoPublish: boolean;
  taxilaOn: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: 'error' | 'ok'; text: string } | null>(null);
  return (
    <form
      action={(fd) => {
        setMsg(null);
        startTransition(async () => {
          const res = await updateSwitchesAction(fd);
          if (res?.error) setMsg({ type: 'error', text: res.error });
          else setMsg({ type: 'ok', text: 'Saved' });
        });
      }}
      className="space-y-4"
      data-testid="switches-form"
    >
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="escalationOn"
            defaultChecked={escalationOn}
            className="mt-1"
            data-testid="escalation-on"
          />
          <span>
            <strong>Escalation</strong> — when a step is overdue, copy the request&apos;s HOG, then
            the Instruction Cell. The plain &ldquo;due soon&rdquo; and &ldquo;overdue&rdquo;
            reminders to the person run either way.
          </span>
        </label>
        <div className="ml-6 flex flex-wrap items-center gap-2 text-sm">
          <Label htmlFor="escalationDays">Copy the HOG after</Label>
          <Input
            id="escalationDays"
            name="escalationDays"
            type="number"
            min={1}
            max={30}
            defaultValue={escalationDays}
            className="h-8 w-20"
          />
          <span>days overdue; the Instruction Cell after twice that.</span>
        </div>
      </div>
      <label className={`flex items-start gap-2 text-sm ${taxilaOn ? '' : 'opacity-60'}`}>
        <input
          type="checkbox"
          name="autoPublish"
          defaultChecked={autoPublish}
          disabled={!taxilaOn}
          className="mt-1"
          data-testid="auto-publish"
        />
        <span>
          <strong>Publish to Taxila automatically after final approval</strong> — only when the
          Taxila check passes; anything else stays Approved and goes to the Instruction Cell&apos;s
          &ldquo;My work&rdquo;. Off until switched on.
          {taxilaOn ? null : ' (Taxila publishing isn’t set up on this server.)'}
        </span>
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Msg msg={msg} />
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  min = 1,
}: {
  name: string;
  label: string;
  defaultValue: number;
  min?: number;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={min} defaultValue={defaultValue} required />
    </div>
  );
}
