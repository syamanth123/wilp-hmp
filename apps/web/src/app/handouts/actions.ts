'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { libraryQuery, parseLibraryFilter } from '@/lib/handout-library';

const MAX_VIEWS = 20;

export interface SaveViewResult {
  ok: boolean;
  message: string;
}

/**
 * "Save this view": keeps the current library address under a name for this person. The address
 * is re-parsed and re-written, so only valid library filters are ever stored; it is re-checked
 * again every time it is opened, so a saved view can never widen what someone sees.
 */
export async function saveLibraryView(name: string, query: string): Promise<SaveViewResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Please sign in again.' };
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!clean) return { ok: false, message: 'Give the view a name.' };
  const sp = Object.fromEntries(new URLSearchParams(query.replace(/^\?/, '')));
  const f = parseLibraryFilter(sp, user.roles);
  const stored = libraryQuery({ ...f, page: 1 });
  const existing = await prisma.savedView.count({ where: { userId: user.id } });
  const same = await prisma.savedView.findUnique({
    where: { userId_name: { userId: user.id, name: clean } },
    select: { id: true },
  });
  if (!same && existing >= MAX_VIEWS) {
    return { ok: false, message: `You can keep up to ${MAX_VIEWS} saved views. Remove one first.` };
  }
  await prisma.savedView.upsert({
    where: { userId_name: { userId: user.id, name: clean } },
    create: { userId: user.id, name: clean, query: stored },
    update: { query: stored },
  });
  revalidatePath('/handouts');
  return { ok: true, message: same ? `Updated “${clean}”.` : `Saved “${clean}”.` };
}

export async function deleteLibraryView(id: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  await prisma.savedView.deleteMany({ where: { id, userId: user.id } });
  revalidatePath('/handouts');
}
