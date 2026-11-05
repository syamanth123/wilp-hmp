import type { BitsHandoutV1 } from '@hmp/db';
import { getLogo, getWatermark } from './assets';
import { buildHandoutDocx } from './build-docx';
import { docxToPdf } from './docx-to-pdf';

/** The approved handout as a PDF — no DRAFT mark (only APPROVED/PUBLISHED handouts get here). */
export async function buildApprovedHandoutPdf(data: BitsHandoutV1): Promise<Buffer> {
  const [logo, watermark] = await Promise.all([getLogo(), getWatermark()]);
  return docxToPdf(await buildHandoutDocx(data, logo, watermark));
}
