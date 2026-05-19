'use server';

import { revalidatePath } from 'next/cache';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  parseCoursesCsv,
  parseProgrammesCsv,
  parseOfferingsCsv,
  parseSlotBookingsCsv,
  type ParseResult,
} from '@hmp/integrations';
import { audit } from '@/lib/audit';

export type ImportKind = 'courses' | 'programmes' | 'offerings' | 'slot_bookings';

export interface PreviewResult {
  ok: boolean;
  kind: ImportKind;
  count: number;
  errors: Array<{ line: number; message: string }>;
  sample: unknown[];
}

function parseByKind(kind: ImportKind, csv: string): ParseResult<unknown> {
  if (kind === 'courses') return parseCoursesCsv(csv);
  if (kind === 'programmes') return parseProgrammesCsv(csv);
  if (kind === 'slot_bookings') return parseSlotBookingsCsv(csv);
  return parseOfferingsCsv(csv);
}

export async function previewImportAction(formData: FormData): Promise<PreviewResult> {
  await requireRole(await getSessionUser(), RoleName.ADMIN);
  const kind = (formData.get('kind') as ImportKind) ?? 'courses';
  const csv = String(formData.get('csv') ?? '');
  const result = parseByKind(kind, csv);
  return {
    ok: result.ok,
    kind,
    count: result.rows.length,
    errors: result.errors,
    sample: result.rows.slice(0, 5),
  };
}

/**
 * Parse a `YYYY-MM-DD` string as **local** midnight, not UTC midnight. Using
 * `new Date('2026-01-05')` would produce UTC 00:00 which renders as the prior
 * day in any positive-UTC timezone (e.g. IST).
 */
function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => Number(p));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export async function commitImportAction(
  formData: FormData,
): Promise<{ ok: boolean; imported?: number; error?: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const kind = (formData.get('kind') as ImportKind) ?? 'courses';
  const csv = String(formData.get('csv') ?? '');
  const result = parseByKind(kind, csv);
  if (!result.ok) {
    return { ok: false, error: `Validation failed (${result.errors.length} rows). Re-run preview.` };
  }

  let imported = 0;
  let snapshotId: string;

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      let count = 0;

      if (kind === 'courses') {
        for (const row of result.rows as Array<{ code: string; title: string; credits: number; description: string }>) {
          await tx.course.upsert({
            where: { code: row.code },
            update: { title: row.title, credits: row.credits, description: row.description || null },
            create: { code: row.code, title: row.title, credits: row.credits, description: row.description || null },
          });
          count += 1;
        }
      } else if (kind === 'programmes') {
        for (const row of result.rows as Array<{
          programme_code: string;
          programme_name: string;
          semester_name: string;
          year: number;
          term: string;
          start_date: string;
          end_date: string;
          exam_date: string;
          ec1_deadline: string;
        }>) {
          const prog = await tx.programme.upsert({
            where: { code: row.programme_code },
            update: { name: row.programme_name },
            create: { code: row.programme_code, name: row.programme_name },
          });
          await tx.semester.upsert({
            where: { programmeId_name: { programmeId: prog.id, name: row.semester_name } },
            update: {
              year: row.year,
              term: row.term,
              startDate: parseDateLocal(row.start_date),
              endDate: parseDateLocal(row.end_date),
              examDate: row.exam_date ? parseDateLocal(row.exam_date) : null,
              ec1Deadline: row.ec1_deadline ? parseDateLocal(row.ec1_deadline) : null,
            },
            create: {
              programmeId: prog.id,
              name: row.semester_name,
              year: row.year,
              term: row.term,
              startDate: parseDateLocal(row.start_date),
              endDate: parseDateLocal(row.end_date),
              examDate: row.exam_date ? parseDateLocal(row.exam_date) : null,
              ec1Deadline: row.ec1_deadline ? parseDateLocal(row.ec1_deadline) : null,
            },
          });
          count += 1;
        }
      } else if (kind === 'offerings') {
        for (const row of result.rows as Array<{
          programme_code: string;
          semester_name: string;
          course_code: string;
          slot_info: string;
        }>) {
          const prog = await tx.programme.findUnique({ where: { code: row.programme_code } });
          const course = await tx.course.findUnique({ where: { code: row.course_code } });
          if (!prog || !course) continue;
          const sem = await tx.semester.findUnique({
            where: { programmeId_name: { programmeId: prog.id, name: row.semester_name } },
          });
          if (!sem) continue;
          await tx.courseOffering.upsert({
            where: { courseId_semesterId: { courseId: course.id, semesterId: sem.id } },
            update: { slotInfo: row.slot_info || null },
            create: { courseId: course.id, semesterId: sem.id, slotInfo: row.slot_info || null },
          });
          count += 1;
        }
      } else {
        // slot_bookings
        for (const row of result.rows as Array<{
          programme_code: string;
          semester_name: string;
          course_code: string;
          slot_type: 'class' | 'exam';
          slot: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          room: string;
        }>) {
          const prog = await tx.programme.findUnique({ where: { code: row.programme_code } });
          const course = await tx.course.findUnique({ where: { code: row.course_code } });
          if (!prog || !course) continue;
          const sem = await tx.semester.findUnique({
            where: { programmeId_name: { programmeId: prog.id, name: row.semester_name } },
          });
          if (!sem) continue;
          const offering = await tx.courseOffering.findUnique({
            where: { courseId_semesterId: { courseId: course.id, semesterId: sem.id } },
          });
          if (!offering) continue;
          await tx.slotBooking.upsert({
            where: {
              courseOfferingId_slotType_slot_dayOfWeek_startTime: {
                courseOfferingId: offering.id,
                slotType: row.slot_type,
                slot: row.slot,
                dayOfWeek: row.day_of_week,
                startTime: row.start_time,
              },
            },
            update: { endTime: row.end_time, room: row.room || null },
            create: {
              courseOfferingId: offering.id,
              slotType: row.slot_type,
              slot: row.slot,
              dayOfWeek: row.day_of_week,
              startTime: row.start_time,
              endTime: row.end_time,
              room: row.room || null,
            },
          });
          count += 1;
        }
      }

      const snapshot = await tx.erpSnapshot.create({
        data: {
          source: 'csv',
          importedBy: actor.id,
          payload: { kind, count, rows: result.rows } as never,
        },
      });

      return { count, snapshotId: snapshot.id };
    });
    imported = txResult.count;
    snapshotId = txResult.snapshotId;
  } catch (err) {
    return {
      ok: false,
      error: `Import rolled back: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }

  await audit({
    actorId: actor.id,
    action: `erp.import.${kind}`,
    entity: 'ErpSnapshot',
    entityId: snapshotId,
    after: { kind, imported },
  });

  revalidatePath('/admin/import');
  revalidatePath('/admin/programmes');
  return { ok: true, imported };
}
