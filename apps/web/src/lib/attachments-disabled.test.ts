import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/handouts/[requestId]/attachments/route';
import { deleteAttachmentAction } from '@/app/(shared)/attachment-actions';
import { ATTACHMENTS_DISABLED } from '@/lib/attachments-feature';

// Prompt 6 hardening — attachments deferred for launch (Option B). Both the
// upload route and the delete action short-circuit BEFORE any auth/DB access,
// so these need no mocks.
describe('attachments disabled for launch', () => {
  it('the feature flag is off', () => {
    expect(ATTACHMENTS_DISABLED).toBe(true);
  });

  it('upload route POST returns 501 attachments_disabled (regardless of status)', async () => {
    const req = new Request('http://localhost/api/handouts/r1/attachments', { method: 'POST' });
    const res = await POST(req, { params: { requestId: 'r1' } });
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe('attachments_disabled');
  });

  it('deleteAttachmentAction returns the disabled error', async () => {
    const res = await deleteAttachmentAction(new FormData());
    expect(res).toEqual({ error: expect.stringMatching(/not enabled/i) });
  });
});
