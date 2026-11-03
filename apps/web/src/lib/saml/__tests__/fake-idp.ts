/**
 * A fake BITS IdP for tests — no network. Makes throwaway key pairs + certificates, the two
 * metadata files (SP in the exact shape make-hmp-sp-metadata.sh writes, IdP like Shibboleth's),
 * and SAML Responses: assertion signed RSA-SHA256 (xml-crypto), optionally encrypted to the SP
 * certificate (xml-encryption, rsa-oaep-mgf1p + aes256-gcm — what our metadata offers first).
 */
import { createPublicKey, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import selfsigned from 'selfsigned';
import { SignedXml } from 'xml-crypto';
import { encrypt } from 'xml-encryption';

export interface Identity {
  keyPem: string;
  certPem: string;
  certB64: string;
}

export function makeIdentity(cn: string): Identity {
  const pems = selfsigned.generate([{ name: 'commonName', value: cn }], {
    keySize: 2048,
    days: 30,
    algorithm: 'sha256',
  });
  return {
    keyPem: pems.private,
    certPem: pems.cert,
    certB64: pems.cert.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
  };
}

export const SP_ENTITY = 'https://hmp.test/api/saml/metadata';
export const ACS = 'https://hmp.test/api/saml/acs';
export const IDP_ENTITY = 'https://idp.test/idp/shibboleth';
export const IDP_SSO = 'https://idp.test/idp/profile/SAML2/Redirect/SSO';

export function spMetadataXml(
  certB64: string,
  o: { entityId?: string; acs?: string } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${o.entityId ?? SP_ENTITY}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="true" WantAssertionsSigned="true">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:KeyDescriptor use="encryption"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
      <md:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"/>
      <md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes256-gcm"/>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${o.acs ?? ACS}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
`;
}

export function idpMetadataXml(certB64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP_ENTITY}">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></KeyDescriptor>
    <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient</NameIDFormat>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.test/idp/profile/SAML2/POST/SSO"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${IDP_SSO}"/>
  </IDPSSODescriptor>
</EntityDescriptor>
`;
}

/** The ID of the AuthnRequest inside an HTTP-Redirect sign-in URL. */
export function requestIdFromUrl(url: string): string {
  const req = new URL(url).searchParams.get('SAMLRequest')!;
  const xml = inflateRawSync(Buffer.from(req, 'base64')).toString('utf8');
  return /\sID="([^"]+)"/.exec(xml)![1]!;
}

export interface ResponseOptions {
  idp: Identity;
  inResponseTo: string;
  attributes?: Record<string, string>;
  nameId?: string;
  audience?: string;
  /** Minutes from now; negative = already expired. */
  validForMin?: number;
  signAssertion?: boolean;
  /** Encrypt the (signed) assertion to this SP certificate. */
  encryptTo?: string;
  /** Also sign the Response envelope (as some IdPs do). */
  signResponse?: boolean;
  /** Applied to the response XML after signing (to break the signature). */
  tamper?: (xml: string) => string;
}

const OIDS: Record<string, string> = {
  mail: 'urn:oid:0.9.2342.19200300.100.1.3',
  uid: 'urn:oid:0.9.2342.19200300.100.1.1',
  cn: 'urn:oid:2.5.4.3',
};

function encryptAsync(xml: string, certPem: string): Promise<string> {
  const rsaPub = createPublicKey(certPem).export({ type: 'spki', format: 'pem' }).toString();
  return new Promise((resolve, reject) =>
    encrypt(
      xml,
      {
        rsa_pub: rsaPub,
        pem: certPem,
        encryptionAlgorithm: 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
        keyEncryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
        disallowEncryptionWithInsecureAlgorithm: true,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    ),
  );
}

/** A base64 SAMLResponse as the IdP would POST it. */
export async function makeResponse(o: ResponseOptions): Promise<string> {
  const now = new Date();
  const until = new Date(now.getTime() + (o.validForMin ?? 5) * 60_000);
  const before = new Date(Math.min(now.getTime(), until.getTime()) - 60_000);
  const iso = (d: Date) => d.toISOString();
  const aId = `_a${randomUUID().replace(/-/g, '')}`;
  const attrs = Object.entries(o.attributes ?? {})
    .map(
      ([k, v]) =>
        `<saml:Attribute Name="${OIDS[k] ?? k}" FriendlyName="${k}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue>${v}</saml:AttributeValue></saml:Attribute>`,
    )
    .join('');

  let assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aId}" Version="2.0" IssueInstant="${iso(now)}"><saml:Issuer>${IDP_ENTITY}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">${o.nameId ?? '_transient123'}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.inResponseTo}" NotOnOrAfter="${iso(until)}" Recipient="${ACS}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(before)}" NotOnOrAfter="${iso(until)}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? SP_ENTITY}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion>`;

  if (o.signAssertion !== false) assertion = signElement(assertion, 'Assertion', o.idp);
  if (o.encryptTo) {
    assertion = `<saml:EncryptedAssertion>${await encryptAsync(assertion, o.encryptTo)}</saml:EncryptedAssertion>`;
  }

  let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${iso(now)}" Destination="${ACS}" InResponseTo="${o.inResponseTo}"><saml:Issuer>${IDP_ENTITY}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;
  if (o.signResponse) xml = signElement(xml, 'Response', o.idp);
  if (o.tamper) xml = o.tamper(xml);
  return Buffer.from(xml).toString('base64');
}

// xml-crypto: put the Signature right after the element's Issuer.
const PLACE_AFTER = 'after' as const;

/** Enveloped RSA-SHA256 signature on the (outermost) element, placed after its Issuer. */
function signElement(xml: string, localName: string, idp: Identity): string {
  const sig = new SignedXml({
    privateKey: idp.keyPem,
    publicCert: idp.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: `/*[local-name(.)='${localName}']`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  sig.computeSignature(xml, {
    prefix: 'ds',
    location: {
      reference: `/*[local-name(.)='${localName}']/*[local-name(.)='Issuer']`,
      action: PLACE_AFTER,
    },
  });
  return sig.getSignedXml();
}
