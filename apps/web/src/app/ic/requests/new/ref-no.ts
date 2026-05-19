import { Prisma, prisma, HandoutStatus } from '@hmp/db';

export const REF_NO_RETRY_LIMIT = 5;
export const REF_NO_RETRY_BASE_MS = 50;

export class RefNoRetryExhausted extends Error {
  constructor(public attempts: number, public year: number) {
    super(
      `Could not allocate a unique refNo after ${attempts} attempts for year ${year}. ` +
        `Concurrent IC create rate is unusually high — investigate.`,
    );
    this.name = 'RefNoRetryExhausted';
  }
}

export interface CreateRequestWithRefNoInput {
  courseOfferingId: string;
  initiatedById: string;
  notes: string | null;
  previousHandoutUrl: string | null;
  /** Override for tests; defaults to current year. */
  year?: number;
}

// `Prisma.TransactionClient = Omit<PrismaClient, ITX_CLIENT_DENYLIST>` —
// PrismaClient is structurally assignable to it, so callers can pass either
// the prisma global or a tx client received from `prisma.$transaction`.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Allocate a refNo (HMP-YYYY-####) and create the HandoutRequest atomically.
 *
 * Two simultaneous callers can read the same "last" row and compute the same
 * candidate refNo. The second insert hits `refNo @unique` (Prisma P2002); we
 * back off with jitter and retry up to REF_NO_RETRY_LIMIT times. The retry is
 * narrow — only P2002 on the `refNo` target — so unrelated constraint failures
 * propagate immediately.
 *
 * Pass a `client` (Prisma tx) so the caller can include this in a wider
 * transaction with the audit write.
 */
export async function createRequestWithRefNo(
  input: CreateRequestWithRefNoInput,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string; refNo: string }> {
  const year = input.year ?? new Date().getFullYear();
  const prefix = `HMP-${year}-`;

  for (let attempt = 1; attempt <= REF_NO_RETRY_LIMIT; attempt++) {
    const last = await client.handoutRequest.findFirst({
      where: { refNo: { startsWith: prefix } },
      orderBy: { refNo: 'desc' },
      select: { refNo: true },
    });
    const nextN = last ? parseInt(last.refNo.slice(prefix.length), 10) + 1 : 1;
    const candidate = `${prefix}${String(nextN).padStart(4, '0')}`;

    try {
      const created = await client.handoutRequest.create({
        data: {
          refNo: candidate,
          courseOfferingId: input.courseOfferingId,
          initiatedById: input.initiatedById,
          status: HandoutStatus.DRAFT,
          notes: input.notes,
          previousHandoutUrl: input.previousHandoutUrl,
        },
        select: { id: true, refNo: true },
      });
      return created;
    } catch (err) {
      if (isRefNoCollision(err)) {
        await sleep(REF_NO_RETRY_BASE_MS + Math.random() * REF_NO_RETRY_BASE_MS);
        continue;
      }
      throw err;
    }
  }
  throw new RefNoRetryExhausted(REF_NO_RETRY_LIMIT, year);
}

function isRefNoCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return (target as unknown[]).includes('refNo');
  if (typeof target === 'string') return target === 'refNo' || target.includes('refNo');
  return false;
}
