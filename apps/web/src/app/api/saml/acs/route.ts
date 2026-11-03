import { NextResponse, type NextRequest } from 'next/server';
import { authSecret, createSsoProof, signIn } from '@hmp/auth';
import { prisma, type RoleName } from '@hmp/db';
import { getSamlSetup } from '@/lib/saml/config';
import { createSaml } from '@/lib/saml/sp';
import { identityFromProfile } from '@/lib/saml/attributes';
import { matchSsoUser, type MatchRefusal } from '@/lib/saml/match-user';
import { prismaUserFinder } from '@/lib/saml/prisma-finder';
import { safeNextPath } from '@/lib/saml/relay';
import { appUrl } from '@/lib/saml/app-url';
import { defaultRouteForUser } from '@/lib/routing';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/saml/acs — the BITS IdP posts the user's browser here with a SAMLResponse.
 *
 * Cross-site by design (from idp.bits-pilani.ac.in), so there is NO same-origin check; what
 * protects it is the response itself: IdP signature on the assertion, our audience and ACS,
 * InResponseTo matching a request we sent (consumed on use), the assertion ID accepted once, and
 * the time window. Then the HMP account is chosen (match-user.ts) and signed in through the
 * `bits-sso` provider with a proof that never leaves this request. Every sign-in and every
 * refusal is audited — refusals with the email only, never assertion contents.
 */

const REFUSAL_PAGE: Record<MatchRefusal, string> = {
  no_identity: 'not_set_up',
  unknown_mail: 'not_set_up',
  unknown_uid: 'not_set_up',
  uid_not_unique: 'not_set_up',
  inactive: 'inactive',
};

const toLogin = (code: string) => NextResponse.redirect(appUrl(`/login?sso=${code}`), 303);

export async function POST(req: NextRequest): Promise<Response> {
  const setup = getSamlSetup();
  if (setup.status !== 'ok') return toLogin('unavailable');

  const ip = clientIpFromHeaders(req.headers);
  const rl = await rateLimit(`saml:acs:${ip}`, 300, 15 * 60);
  if (!rl.ok) return toLogin('busy');

  let samlResponse = '';
  let relayState = '';
  try {
    const form = await req.formData();
    samlResponse = String(form.get('SAMLResponse') ?? '');
    relayState = String(form.get('RelayState') ?? '');
  } catch {
    /* not a form post — treated as an invalid response below */
  }

  let profile: Record<string, unknown> | null = null;
  try {
    if (!samlResponse) throw new Error('no SAMLResponse');
    const result = await createSaml(setup.settings).validatePostResponseAsync({
      SAMLResponse: samlResponse,
    });
    profile = (result.profile as Record<string, unknown> | null) ?? null;
    if (!profile) throw new Error('no profile in the response');
  } catch (e) {
    await safeAudit({
      action: 'auth.sso.refused',
      entityId: 'saml',
      after: {
        reason: 'invalid_response',
        detail: String((e as Error).message ?? e).slice(0, 200),
      },
      ip,
    });
    return toLogin('failed');
  }

  const match = await matchSsoUser(identityFromProfile(profile), prismaUserFinder);
  if (!match.ok) {
    await safeAudit({
      action: 'auth.sso.refused',
      entityId: match.email ?? 'unknown',
      after: { reason: match.reason, email: match.email },
      ip,
    });
    return toLogin(REFUSAL_PAGE[match.reason]);
  }

  try {
    await signIn('bits-sso', {
      proof: await createSsoProof(match.userId, authSecret()),
      // Explicit, or Auth.js falls back to the Referer — here the IdP's page.
      redirectTo: '/',
      redirect: false,
    });
  } catch (e) {
    await safeAudit({
      action: 'auth.sso.refused',
      entityId: match.email,
      after: { reason: 'session_failed', detail: String((e as Error).message ?? e).slice(0, 200) },
      ip,
    });
    return toLogin('failed');
  }

  await safeAudit({
    actorId: match.userId,
    action: 'auth.sso.login',
    entityId: match.userId,
    after: { via: match.via },
    ip,
  });

  const memberships = await prisma.userRole.findMany({
    where: { userId: match.userId },
    select: { role: { select: { name: true } } },
  });
  const roles = memberships.map((m) => m.role.name) as RoleName[];
  const next =
    safeNextPath(relayState) ??
    defaultRouteForUser({ id: match.userId, email: match.email, name: '', roles, permissions: [] });
  return NextResponse.redirect(appUrl(next), 303);
}

async function safeAudit(input: {
  actorId?: string;
  action: string;
  entityId: string;
  after: unknown;
  ip: string;
}): Promise<void> {
  try {
    await audit({ ...input, entity: 'Auth' });
  } catch (e) {
    console.warn('[saml] audit failed', (e as Error).message);
  }
}
