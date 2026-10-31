import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { BulkToolsHub } from '@/components/bulk-tool';

export const dynamic = 'force-dynamic';

export default async function PcBulkToolsPage() {
  requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  return <BulkToolsHub role="PC" />;
}
