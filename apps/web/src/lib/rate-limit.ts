import { Redis } from 'ioredis';
import { audit } from '@/lib/audit';

/**
 * Fixed-window rate limiting (Prompt 20). Node-runtime only — this module must
 * NEVER be imported by middleware.ts (Edge runtime; ioredis is Node-only).
 * Applied at Node-runtime endpoints: the auth route wrapper, the attachments
 * Route Handler, and the AI server actions.
 *
 * FAIL-OPEN: on any Redis error (or unconfigured Redis) the request is ALLOWED,
 * with a `ratelimit.unavailable` audit row + console.warn. Rationale: total auth
 * lockout during a Redis outage is worse than a brief brute-force window during
 * the same outage. Monitor via audit-log frequency.
 */

// Rate-limit Redis client — DISTINCT from the BullMQ connection (@hmp/queue).
// BullMQ uses maxRetriesPerRequest: null (commands queue forever — fine for
// background jobs). Rate limiting must FAIL FAST: a Redis outage must not hang
// user-facing requests. The fail-open path below depends on these four settings
// producing a quick error rather than a hang.
let client: Redis | null = null;
function getClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (client) return client;
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 1000,
  });
  // ioredis emits 'error' on connection trouble; swallow so an unreachable
  // Redis logs once rather than crashing the process with an unhandled event.
  client.on('error', () => {});
  return client;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  /** True when the limiter could not consult Redis and failed open. */
  degraded?: boolean;
}

/** Canonical per-endpoint limits (one place to tune). */
export const RATE_LIMITS = {
  login: { limit: 5, windowSec: 15 * 60 }, // 5 / 15 min per IP
  upload: { limit: 10, windowSec: 60 * 60 }, // 10 / hour per user
  ai: { limit: 20, windowSec: 60 * 60 }, // 20 / hour per user
} as const;

/**
 * Fixed-window counter. `key` is caller-namespaced (e.g. `login:1.2.3.4`).
 * INCR is atomic (Redis single-threaded); EXPIRE is set only on the first hit
 * of a window so the window doesn't slide.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redis = getClient();
  if (!redis) {
    // Redis not configured — fail open (dev without REDIS_URL).
    return { ok: true, remaining: limit, retryAfterSec: 0, degraded: true };
  }
  try {
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSec);
    if (count > limit) {
      const ttl = await redis.ttl(k);
      return { ok: false, remaining: 0, retryAfterSec: ttl > 0 ? ttl : windowSec };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSec: 0 };
  } catch (err) {
    // FAIL OPEN. The audit write has its OWN error boundary so an audit/DB
    // failure during a Redis outage can't propagate up and break the request.
    try {
      await audit({
        action: 'ratelimit.unavailable',
        entity: 'RateLimit',
        entityId: key,
        after: { key, error: err instanceof Error ? err.message : String(err) },
      });
    } catch (auditErr) {
      console.warn('[rate-limit] audit failed', auditErr);
    }
    console.warn('[rate-limit] redis unavailable — failing open', key, err);
    return { ok: true, remaining: limit, retryAfterSec: 0, degraded: true };
  }
}

/** 429 response with a Retry-After header (for HTTP Route Handlers + auth route). */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(1, retryAfterSec)),
    },
  });
}
