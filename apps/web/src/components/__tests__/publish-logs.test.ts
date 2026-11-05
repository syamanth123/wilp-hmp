import { expect, it, vi } from 'vitest';

vi.mock('@hmp/db', () => ({ prisma: {} }));
import { publishLogBadge } from '../publish-logs';

it('only a real failure shows as a red "Failed"', () => {
  expect(publishLogBadge('success')).toEqual({ label: 'Published', variant: 'success' });
  expect(publishLogBadge('MANUALLY_CONFIRMED')).toEqual({
    label: 'Published (confirmed)',
    variant: 'success',
  });
  expect(publishLogBadge('EXPORTED')).toEqual({ label: 'Export prepared', variant: 'secondary' });
  expect(publishLogBadge('failed')).toEqual({ label: 'Failed', variant: 'destructive' });
});
