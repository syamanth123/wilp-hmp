import { afterEach, describe, expect, it, vi } from 'vitest';

// With no TAXILA_TOKEN (or URL) every Taxila action refuses at once and Taxila is never called —
// the IC keeps the ZIP export (review of PR #49, point 3).

const { session } = vi.hoisted(() => ({
  session: {
    user: { id: 'ic1', email: 'ic@x', name: 'IC', roles: ['INSTRUCTION_CELL'], permissions: [] },
  },
}));
vi.mock('@hmp/auth', async () => {
  const rbac = await import('@hmp/auth/src/rbac');
  return { getSessionUser: async () => session.user, requireRole: rbac.requireRole };
});
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ redirect: () => undefined }));

import { checkTaxilaAction, publishTaxilaAction } from '../../requests/[id]/actions';
import { createTaxilaRunAction, runStepAction } from '../actions';

const NOT_SET_UP = 'Publishing to Taxila isn’t set up on this server.';
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

describe('Taxila off (no token)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['no settings at all', {}],
    ['a URL but no token', { TAXILA_URL: 'https://taxila.example/webservice/' }],
  ])('%s: every action refuses and nothing reaches the network', async (_, env) => {
    vi.stubEnv('TAXILA_URL', '');
    vi.stubEnv('TAXILA_TOKEN', '');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const fd = { requestId: 'cmqf3wxjd00041d8ymcf9kmgf', semesterCode: 'S1-26' };
    expect(await checkTaxilaAction(form(fd))).toEqual({ error: NOT_SET_UP });
    expect(await publishTaxilaAction(form(fd))).toEqual({ error: NOT_SET_UP });
    expect(
      await createTaxilaRunAction(form({ semesterCode: 'S1-26', requestId: fd.requestId })),
    ).toEqual({
      error: NOT_SET_UP,
    });
    expect(await runStepAction('cmqf3wxjd00041d8ymcf9kmgf', 'publish')).toEqual({
      error: NOT_SET_UP,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
