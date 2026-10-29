'use server';

import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { ensureCorpusEmbeddings, AiUnconfiguredError } from '@hmp/ai';
import { audit } from '@/lib/audit';
import { AI_OFF_MESSAGE, aiFeaturesEnabled } from '@/lib/features';

export async function runReEmbedAction(): Promise<
  { courses: number; faculty: number; skipped: number } | { error: string }
> {
  // AI switched off: refuse before anything else.
  if (!aiFeaturesEnabled()) return { error: AI_OFF_MESSAGE };
  let me;
  try {
    me = requireRole(await getSessionUser(), RoleName.ADMIN);
  } catch {
    return { error: 'Forbidden' };
  }

  try {
    const result = await ensureCorpusEmbeddings({ actorId: me.id, operation: 'EMBEDDING' });
    await audit({
      actorId: me.id,
      action: 'ai.embeddings.refreshed',
      entity: 'Embedding',
      entityId: 'corpus',
      after: result,
    });
    return result;
  } catch (err) {
    if (err instanceof AiUnconfiguredError) {
      return { error: "AI isn't set up on this server. Ask IT to enable it." };
    }
    console.error('re_embed_failed', err);
    return { error: "Couldn't refresh the matching data. Try again." };
  }
}
