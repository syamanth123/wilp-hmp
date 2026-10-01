import { Prisma } from '@hmp/db';
import { DibbaError } from '@hmp/db/src/dibba-import';

/**
 * Server-action error contract for the Course Dibba screens (plan D11). The
 * db core throws typed DibbaErrors; the IC sees a sentence that tells them
 * what to do, never a stack or a Prisma code. Server-only (imports the
 * dibba-import sub-barrel) — call from actions.ts, not from client components.
 */
export function dibbaErrorMessage(err: unknown, verb: string): string {
  if (err instanceof DibbaError || (err instanceof Error && err.name === 'DibbaError')) {
    const code = (err as DibbaError).code;
    if (code === 'not_found') return 'That import no longer exists — refresh the page.';
    if (code === 'not_draft') {
      return 'This import is no longer a draft (someone published or discarded it) — refresh the page.';
    }
    if (code === 'term_exists') return err.message;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2028: interactive-transaction timeout — most likely waiting on the term lock.
    if (err.code === 'P2028') {
      return 'Another publish for this term is in progress — try again in a moment.';
    }
    if (err.code === 'P2002') return 'A term with that name or year/term already exists.';
  }
  console.error(`[dibba.${verb.replace(/\s+/g, '-')}]`, err);
  return `Could not ${verb} right now — please retry.`;
}
