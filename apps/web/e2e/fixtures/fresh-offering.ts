import type { Page } from '@playwright/test';
import type { PrismaClient } from '@hmp/db';

/**
 * v1.4.2: New request refuses a course that already has a request this semester (duplicate guard, F5). Specs
 * that create requests through the form used to request "the first course" every time; now each gets a fresh
 * course offering of its own, in the programme and semester it would have picked (so the same department and
 * HOG), and selects it. Leaves the seeded offerings untouched.
 *
 * On /ic/requests/new: selects programme (by code, or the first one) and its first semester, adds the offering,
 * reloads, and selects programme → semester → the new offering.
 */
export async function pickFreshCourse(
  page: Page,
  prisma: PrismaClient,
  programmeCode?: string,
): Promise<{ offeringId: string; courseCode: string }> {
  const programme = page.getByLabel('Programme');
  if (programmeCode) await programme.selectOption(programmeCode);
  else await programme.selectOption({ index: 1 });
  const prog = await programme.inputValue();
  await page.getByLabel('Semester').selectOption({ index: 1 });
  const sem = await page.getByLabel('Semester').inputValue();
  const semester = await prisma.semester.findFirstOrThrow({
    where: { name: sem, programme: { code: prog } },
    select: { id: true },
  });

  let created: { offeringId: string; courseCode: string } | null = null;
  for (let attempt = 0; !created && attempt < 20; attempt++) {
    const n = 100 + Math.floor(Math.random() * 900);
    const code = `EZ ZG${n}`;
    if (await prisma.course.findUnique({ where: { bitsCourseNumber: code } })) continue;
    const course = await prisma.course.create({
      data: { code, bitsCourseNumber: code, title: `E2E course ${n}` },
    });
    const off = await prisma.courseOffering.create({
      data: { courseId: course.id, semesterId: semester.id },
    });
    created = { offeringId: off.id, courseCode: code };
  }
  if (!created) throw new Error('pickFreshCourse: no free course code');

  await page.reload();
  await page.getByLabel('Programme').selectOption(prog);
  await page.getByLabel('Semester').selectOption(sem);
  await page.getByLabel('Course').selectOption(created.offeringId);
  return created;
}
