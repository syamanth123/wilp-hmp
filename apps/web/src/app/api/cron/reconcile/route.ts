import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { runReconciliationSweep } from '@/lib/reconciliation';

// Reconciliation sweep endpoint (Prompt 21). Same external-cron pattern as
// /api/cron/reminders: an authenticated HTTPS request from the platform
// scheduler (daily, off-peak) triggers the sweep. Bearer auth via CRON_SECRET.
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

export async function POST(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const summary = await runReconciliationSweep();
  return Response.json(summary);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const summary = await runReconciliationSweep();
  return Response.json(summary);
}
