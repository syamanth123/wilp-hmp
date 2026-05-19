'use client';

import { useState, useTransition } from 'react';
import { Button, Input, Label } from '@hmp/ui';
import { updateWorkflowAction } from './actions';

type Config = {
  hogReviewSla: number;
  pcReviewSla: number;
  facultySubmitSla: number;
  hogFinalSla: number;
  offCampusMaxCourses: number;
};

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
      className="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      <Field name="hogReviewSla" label="HOG review SLA (hrs)" defaultValue={config.hogReviewSla} />
      <Field name="pcReviewSla" label="PC review SLA (hrs)" defaultValue={config.pcReviewSla} />
      <Field name="facultySubmitSla" label="Faculty submit SLA (hrs)" defaultValue={config.facultySubmitSla} />
      <Field name="hogFinalSla" label="HOG final approval SLA (hrs)" defaultValue={config.hogFinalSla} />
      <Field name="offCampusMaxCourses" label="Off-campus max courses / sem" defaultValue={config.offCampusMaxCourses} />
      <div className="md:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {msg ? (
          <span className={'ml-3 text-sm ' + (msg.type === 'error' ? 'text-destructive' : 'text-emerald-600')}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: number }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={1} defaultValue={defaultValue} required />
    </div>
  );
}
