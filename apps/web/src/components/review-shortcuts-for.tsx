import { getSessionUser } from '@hmp/auth';
import { nextWorkHref, type WorkRole } from '@/lib/my-work';
import { ReviewShortcuts } from './review-shortcuts';

/** v1.4.2 (F15): keyboard shortcuts under a review panel; N opens the next item in the person's My work. */
export async function ReviewShortcutsFor({
  role,
  requestId,
}: {
  role: WorkRole;
  requestId: string;
}) {
  const me = await getSessionUser();
  if (!me) return null;
  return <ReviewShortcuts nextHref={await nextWorkHref(me, role, requestId)} />;
}
