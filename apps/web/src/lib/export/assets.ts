import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The PNGs embedded in every Word/PDF export (read once per process). Shared by the download
// route and the Taxila publisher (v1.3.0), so both build exactly the same file.
const ASSETS = join(process.cwd(), 'src', 'lib', 'export', 'assets');

const cache = new Map<string, Promise<Buffer>>();
const asset = (name: string) => {
  if (!cache.has(name)) cache.set(name, readFile(join(ASSETS, name)));
  return cache.get(name)!;
};

export const getLogo = () => asset('bits-header.png');
/** Pre-faded 12%-alpha crest. */
export const getWatermark = () => asset('bits-watermark.png');
/** Pre-faded 16%-alpha "DRAFT" mark. */
export const getDraftDiagonal = () => asset('draft-diagonal.png');
