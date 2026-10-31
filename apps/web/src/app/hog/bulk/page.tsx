import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { BulkToolsHub } from '@/components/bulk-tool';

export const dynamic = 'force-dynamic';

export default async function HogBulkToolsPage() {
  requireRole(await getSessionUser(), RoleName.HOG);
  return <BulkToolsHub role="HOG" />;
}
