import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { scanActiveRequestsWithSla } from '@/lib/sla';
import { notifySlaReminder } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

async function runSweep() {
  const rows = await scanActiveRequestsWithSla();
  let dueSoon = 0;
  let overdue = 0;
  let notified = 0;
  for (const r of rows) {
    if (r.sla.classification !== 'due_soon' && r.sla.classification !== 'overdue') continue;
    if (r.sla.classification === 'due_soon') dueSoon += 1;
    else overdue += 1;
    if (r.sla.slaHours == null) continue;
    notified += await notifySlaReminder({
      request: { id: r.id, refNo: r.refNo, status: r.status },
      classification: r.sla.classification,
      ageHours: r.sla.ageHours,
      slaHours: r.sla.slaHours,
    });
  }
  return { scanned: rows.length, dueSoon, overdue, notified };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const summary = await runSweep();
  return Response.json(summary);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const summary = await runSweep();
  return Response.json(summary);
}
