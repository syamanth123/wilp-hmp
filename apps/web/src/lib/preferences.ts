import { createHash, randomBytes } from 'node:crypto';
import { prisma, type Prisma } from '@hmp/db';

/**
 * v1.4.2 — a person's own settings (UserPreference): email mode, weekly summary, away / back-up, the
 * choices HMP remembers for them (F12) and the calendar link (F9, stored only as a SHA-256 fingerprint).
 */

export async function getPreference(userId: string) {
  return prisma.userPreference.findUnique({
    where: { userId },
    include: { backupUser: { select: { id: true, name: true, email: true } } },
  });
}

// ---- remembered choices (F12) -------------------------------------------------------------------

/** What HMP remembers per person. Values are re-validated by the page that uses them. */
export type RememberedKey = 'dashboardTerm' | 'kickoffTerm' | 'newRequestSemester' | 'scheduleTerm';

const VALUE_RE = /^[\w.:-]{1,60}$/;

export async function rememberedChoice(
  userId: string,
  key: RememberedKey,
): Promise<string | undefined> {
  const p = await prisma.userPreference.findUnique({
    where: { userId },
    select: { lastUsed: true },
  });
  const v = (p?.lastUsed as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' && VALUE_RE.test(v) ? v : undefined;
}

export async function rememberChoice(
  userId: string,
  key: RememberedKey,
  value: string | null,
): Promise<void> {
  if (value != null && !VALUE_RE.test(value)) return;
  const p = await prisma.userPreference.findUnique({
    where: { userId },
    select: { lastUsed: true },
  });
  const now = { ...((p?.lastUsed as Record<string, unknown> | null) ?? {}) };
  if (now[key] === value) return;
  if (value == null) delete now[key];
  else now[key] = value;
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, lastUsed: now as Prisma.InputJsonValue },
    update: { lastUsed: now as Prisma.InputJsonValue },
  });
}

// ---- calendar link (F9, H21) --------------------------------------------------------------------

export const calendarTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** A new private calendar link; the old one stops working. Returns the token once — never stored. */
export async function newCalendarToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const hash = calendarTokenHash(token);
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, calendarTokenHash: hash, calendarTokenAt: new Date() },
    update: { calendarTokenHash: hash, calendarTokenAt: new Date() },
  });
  return token;
}

export async function stopCalendarLink(userId: string): Promise<void> {
  await prisma.userPreference.updateMany({
    where: { userId },
    data: { calendarTokenHash: null, calendarTokenAt: null },
  });
}
