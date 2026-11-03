import { prisma } from '@hmp/db';
import type { MatchCandidate, UserFinder } from './match-user';

const select = { id: true, email: true, active: true } as const;

/** Database lookups for matchSsoUser(). Case-insensitive, like the emails people type. */
export const prismaUserFinder: UserFinder = {
  async byEmail(email) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select,
    });
  },
  async byEmailLocalPart(localPart) {
    const prefix = `${localPart.toLowerCase()}@`;
    const rows: MatchCandidate[] = await prisma.user.findMany({
      where: { email: { startsWith: prefix, mode: 'insensitive' } },
      select,
      take: 10,
    });
    // Re-check in code: `_` is a LIKE wildcard and a valid uid character.
    return rows.filter((u) => u.email.toLowerCase().startsWith(prefix));
  },
};
