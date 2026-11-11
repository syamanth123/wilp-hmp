import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { runScheduled } from '@/lib/daily-run';

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

/**
 * v1.4.2: the daily run (reminders, escalation, digests — lib/daily-run.ts). The worker runs it at 09:00 on
 * its own; this address stays for a server timer set up before v1.4.2. Either way it runs once a day.
 */
async function runSweep() {
  return runScheduled('daily');
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
