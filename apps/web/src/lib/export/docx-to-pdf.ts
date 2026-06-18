import { convertViaSoffice, SofficeError, sofficeAvailable } from '@hmp/db/src/soffice';

/**
 * docx → PDF via LibreOffice headless (Prompt 23-b). As of Prompt 24 this is a
 * thin caller over the shared `@hmp/db/src/soffice` helper — the hardened
 * subprocess path (per-invocation profile, timeout, temp cleanup, typed errors)
 * lives there and is shared with the corpus `.doc`→`.docx` conversion.
 *
 * Signature preserved exactly so the Prompt 23-b export route + tests are
 * behavior-unchanged. `SofficeError` (formerly `PdfConversionError`) carries the
 * same `kind` union; re-exported here for the route's status mapping.
 */
export { SofficeError, sofficeAvailable } from '@hmp/db/src/soffice';
export type { SofficeErrorKind } from '@hmp/db/src/soffice';

/** Back-compat probe alias (the 23-b test imported this name). */
export const libreOfficeAvailable = sofficeAvailable;

/** Convert a .docx buffer to a PDF buffer. Throws `SofficeError`. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  return convertViaSoffice(docx, 'docx', 'pdf');
}
