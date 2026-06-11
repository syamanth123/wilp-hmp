'use server';

import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { ensureCorpusEmbeddings, AiUnconfiguredError } from '@hmp/ai';
import { audit } from '@/lib/audit';

export async function runReEmbedAction(): Promise<
  { courses: number; faculty: number; skipped: number } | { error: string }
> {
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
      return { error: 'AI provider not configured. Set AI_PROVIDER + API key first.' };
    }
    return { error: err instanceof Error ? err.message : 'Re-embed failed' };
  }
}
