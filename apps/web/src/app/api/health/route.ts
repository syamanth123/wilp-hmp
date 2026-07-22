import { NextResponse } from 'next/server';
import { Redis } from 'ioredis';
import { prisma } from '@hmp/db';

// Liveness/readiness probe for the deploy script + external monitors (CloudWatch).
// - NOT authenticated (the auth middleware matcher already excludes /api) and
//   NOT rate-limited — throttling a health check would defeat its purpose.
// - force-dynamic + no-store: never cached; every hit really probes the deps.
// - Fast: a cheap `SELECT 1` and a Redis PING, both with tight timeouts, so it
//   returns well inside Nginx's proxy_read_timeout.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STARTED_AT = Date.now();

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// Dedicated, lazily-created client (fail-fast settings so a Redis outage can't
// hang the probe). Distinct from the BullMQ + rate-limit clients.
let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  redisClient.on('error', () => {}); // swallow — a failed PING below reports it
  return redisClient;
}

async function checkRedis(): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    return (await client.ping()) === 'PONG'; // lazyConnect: auto-connects here
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  const ok = db && redis;
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      db: db ? 'connected' : 'unreachable',
      redis: redis ? 'connected' : 'unreachable',
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
      version: process.env.GIT_SHA ?? 'unknown',
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
