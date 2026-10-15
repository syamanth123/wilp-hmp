import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { fmtDate } from '../../../format';
import { toDateInputValue } from '../../../date-input';
import { SlotTimingsForm } from './slot-timings-form';
import { ExamDatesForm, type ExamCell, type ExamSlotRow } from './exam-dates-form';

export const dynamic = 'force-dynamic';

const EMPTY: ExamCell = { date: '', startTime: '', endTime: '' };

/**
 * /ic/dibba/terms/[termId]/slots — class time and exam dates per slot (Course
 * Dibba Phase 4, plan §1). Two independent forms so a typo in one cannot block
 * saving the other. Wording is deliberately neutral: "slot", "class time",
 * "exam date" (spec §10.1 is still open).
 */
export default async function ICTermSlotsPage({ params }: { params: { termId: string } }) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const term = await prisma.academicTerm.findUnique({
    where: { id: params.termId },
    include: {
      slots: { orderBy: { slotNo: 'asc' } },
      examDates: true,
    },
  });
  if (!term) notFound();

  const examBySlot = new Map<string, ExamCell>();
  for (const e of term.examDates) {
    examBySlot.set(`${e.slotNo}|${e.kind}`, {
      date: toDateInputValue(e.date),
      startTime: e.startTime ?? '',
      endTime: e.endTime ?? '',
    });
  }
  const examRows: ExamSlotRow[] = term.slots.map((s) => ({
    slotNo: s.slotNo,
    day: s.day,
    session: s.session,
    MID_SEM: examBySlot.get(`${s.slotNo}|MID_SEM`) ?? EMPTY,
    COMPREHENSIVE: examBySlot.get(`${s.slotNo}|COMPREHENSIVE`) ?? EMPTY,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/ic/dibba" className="underline-offset-4 hover:underline">
            Course Dibba
          </Link>{' '}
          /{' '}
          <Link href={`/ic/dibba/terms/${term.id}`} className="underline-offset-4 hover:underline">
            {term.name}
          </Link>{' '}
          / Slots
        </p>
        <h1 className="text-2xl font-semibold">Slots — {term.name}</h1>
        <p className="text-muted-foreground text-sm">
          {fmtDate.format(term.startDate)} – {fmtDate.format(term.endDate)} · exam dates may fall up
          to 30 days before the start and 60 days after the end.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Class times</CardTitle>
          <CardDescription>
            When each slot meets. Leave a slot blank if its time is not fixed yet; faculty then see
            the slot without a time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlotTimingsForm
            termId={term.id}
            slots={term.slots.map((s) => ({
              slotNo: s.slotNo,
              day: s.day,
              session: s.session,
              startTime: s.startTime,
              endTime: s.endTime,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exam dates</CardTitle>
          <CardDescription>
            Mid-semester and comprehensive exam date per slot, with an optional time. Clear the date
            to remove an entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExamDatesForm termId={term.id} slots={examRows} />
        </CardContent>
      </Card>
    </div>
  );
}
