'use client';

import { useState, useTransition } from 'react';
import { Button, Input, Label } from '@hmp/ui';
import { updateSemesterDatesAction } from '../actions';

interface Props {
  semesterId: string;
  examDate: string;
  ec1Deadline: string;
}

export function SemesterDatesForm({ semesterId, examDate, ec1Deadline }: Props) {
  const [exam, setExam] = useState(examDate);
  const [ec1, setEc1] = useState(ec1Deadline);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const save = () => {
    setError(null);
    setSavedAt(null);
    const fd = new FormData();
    fd.set('semesterId', semesterId);
    fd.set('examDate', exam);
    fd.set('ec1Deadline', ec1);
    startTransition(async () => {
      const r = await updateSemesterDatesAction(fd);
      if (r?.error) setError(r.error);
      else setSavedAt(new Date().toLocaleTimeString());
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="examDate">Exam date</Label>
          <Input
            id="examDate"
            type="date"
            value={exam}
            onChange={(e) => setExam(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ec1Deadline">EC1 deadline</Label>
          <Input
            id="ec1Deadline"
            type="date"
            value={ec1}
            onChange={(e) => setEc1(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {savedAt && <p className="text-sm text-emerald-600">Saved at {savedAt}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save dates'}
        </Button>
      </div>
    </div>
  );
}
