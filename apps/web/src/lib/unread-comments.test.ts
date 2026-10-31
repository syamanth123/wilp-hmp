import { describe, expect, it } from 'vitest';
import { commentIdsFromMeta } from './unread-comments';

describe('commentIdsFromMeta', () => {
  it('collects comment ids from comment notifications only', () => {
    const ids = commentIdsFromMeta([
      { kind: 'comment.added', commentId: 'c1', requestId: 'r1' },
      { kind: 'comment.added', commentId: 'c2' },
      { kind: 'workflow', event: 'SUBMITTED', requestId: 'r1' },
      { kind: 'sla.reminder', requestId: 'r1' },
      null,
      'not an object',
      { kind: 'comment.added' },
    ]);
    expect([...ids].sort()).toEqual(['c1', 'c2']);
  });

  it('counts a comment once even if notified twice', () => {
    expect(
      commentIdsFromMeta([
        { kind: 'comment.added', commentId: 'c1' },
        { kind: 'comment.added', commentId: 'c1' },
      ]).size,
    ).toBe(1);
  });
});
