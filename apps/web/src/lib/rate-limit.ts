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
  // Login uses TWO independent limits (Prompt 6 hardening). A LOOSE per-IP cap
  // tolerates a shared campus NAT (hundreds of WILP faculty behind one BITS
  // public IP), while a TIGHT per-username cap stops targeted brute-force and
  // bounds username enumeration to 5 guesses / account / 15 min. If NAT lockouts
  // appear in the first week, raising loginIp is expected and low-risk.
  loginIp: { limit: 30, windowSec: 15 * 60 }, // 30 / 15 min per IP
  loginUser: { limit: 5, windowSec: 15 * 60 }, // 5 / 15 min per username
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

/** Clear a counter. Best-effort (fail-open): a failed delete just means the
 * counter expires on its own window. */
export async function resetRateLimit(key: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(`rl:${key}`);
  } catch {
    /* counter will expire naturally */
  }
}

const loginUserKey = (email: string): string => `login:user:${email.trim().toLowerCase()}`;

/**
 * Login rate limit (Prompt 6): per-IP (NAT-tolerant) AND per-username
 * (brute-force + enumeration), both incremented on every attempt. Either
 * tripping blocks. Returns a single `ok` so the caller can't reveal WHICH limit
 * fired — the generic "too many attempts" message must not leak the vector to a
 * prober. Email is lowercased/trimmed so `Foo@x` and `foo@x` share a counter.
 */
export async function loginRateLimit(
  ip: string,
  email: string,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const [ipRes, userRes] = await Promise.all([
    rateLimit(`login:ip:${ip}`, RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.windowSec),
    rateLimit(loginUserKey(email), RATE_LIMITS.loginUser.limit, RATE_LIMITS.loginUser.windowSec),
  ]);
  if (!ipRes.ok || !userRes.ok) {
    return { ok: false, retryAfterSec: Math.max(ipRes.retryAfterSec, userRes.retryAfterSec) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * On a SUCCESSFUL login, clear the per-username counter so a legitimate user
 * isn't left in a hostile state. The per-IP counter is deliberately NOT reset —
 * a valid login from a shared NAT must not refund the budget for an attacker
 * behind the same IP.
 */
export async function clearLoginUsername(email: string): Promise<void> {
  await resetRateLimit(loginUserKey(email));
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
