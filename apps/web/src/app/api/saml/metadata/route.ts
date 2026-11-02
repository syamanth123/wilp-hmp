import { getSamlSetup } from '@/lib/saml/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/saml/metadata — our entityID. Serves the SP metadata file IT registered, byte for
 * byte, so what this URL shows is exactly what the IdP has. Public by design (certificate only,
 * no private key). 404 while BITS sign-in isn't set up or its files don't agree.
 */
export async function GET(): Promise<Response> {
  const setup = getSamlSetup();
  if (setup.status !== 'ok') return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(setup.settings.spMetadataXml), {
    headers: {
      'content-type': 'application/samlmetadata+xml',
      'cache-control': 'public, max-age=300',
    },
  });
}
