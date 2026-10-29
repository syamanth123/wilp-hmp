import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import type { ScheduleCourse } from '@hmp/db/src/dibba-schedule';
import { dateFormatter } from '@/lib/format-date';

const fmtInt = new Intl.NumberFormat('en-IN');
// One date style everywhere, in India time (lib/format-date.ts).
const fmtDate = dateFormatter;
const KIND_LABEL: Record<string, string> = {
  MID_SEM: 'Mid-sem',
  COMPREHENSIVE: 'Comprehensive',
  MAKEUP: 'Make-up',
};

export const courseTestId = (key: string): string =>
  `faculty-schedule-course-${key.replace(/[^A-Za-z0-9]+/g, '-')}`;

/** One course (cross-listed codes merged) with its slots, batches, exams and co-instructors. */
export function CourseCard({ course }: { course: ScheduleCourse }) {
  return (
    <Card data-testid={courseTestId(course.key)} data-clash={course.clash ? 'true' : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-mono">{course.codes.join(' / ')}</span>
          {course.clash && <Badge variant="destructive">Clash</Badge>}
          {course.sources.includes('assignment') && <Badge variant="outline">Your handout</Badge>}
          {course.sources.includes('instructor') && (
            <Badge variant="secondary">From faculty sheet</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {course.title} · {fmtInt.format(course.students)} students
          {course.coInstructors.length > 0 && (
            <>
              {' '}
              · with{' '}
              {course.coInstructors.map((c, i) => (
                <span key={`${c.name}-${i}`}>
                  {i > 0 ? ', ' : ''}
                  {c.name}
                  {c.isLead ? ' (Lead)' : ''}
                </span>
              ))}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {course.slots.map((s) => (
          <div
            key={s.slotNo}
            className={`rounded-md border p-3 ${s.clash ? 'border-red-300 bg-red-50/40' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-medium">
                {s.slotNo === 0 ? 'No slot' : `SL${s.slotNo}`}
              </span>
              {s.day && s.session && (
                <span>
                  {s.day} {s.session}
                </span>
              )}
              <span className="text-muted-foreground">
                {s.startTime
                  ? `Class time ${s.startTime}–${s.endTime ?? ''}`
                  : s.classTimeHint
                    ? `Dibba says ${s.classTimeHint}`
                    : 'class time not set'}
              </span>
              {s.exams.map((e) => (
                <Badge key={e.kind} variant="outline">
                  {KIND_LABEL[e.kind] ?? e.kind} {fmtDate.format(e.date)}
                  {e.startTime ? ` ${e.startTime}` : ''}
                </Badge>
              ))}
              {s.clash && (
                <span className="text-xs font-medium text-red-700">
                  clashes with another course of yours
                </span>
              )}
            </div>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-2 font-medium">Programme</th>
                  <th className="py-1 pr-2 font-medium">Batch</th>
                  <th className="py-1 pr-2 text-right font-medium">Students</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={`${r.programmeCode}|${r.admitBatch}|${i}`} className="border-t">
                    <td className="py-1 pr-2">
                      <span className="font-mono">{r.programmeCode}</span>{' '}
                      <span className="text-muted-foreground">{r.programmeTitle}</span>
                    </td>
                    <td className="py-1 pr-2">
                      {r.admitBatch ?? (r.isNewAdmission ? 'New batch' : '—')}
                      {r.isBacklogRow ? ' (backlog)' : ''}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {r.studentCount == null ? '—' : fmtInt.format(r.studentCount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="py-1 pr-2" colSpan={2}>
                    Total in this slot
                  </td>
                  <td className="py-1 pr-2 text-right">{fmtInt.format(s.students)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
