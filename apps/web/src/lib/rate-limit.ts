import { Redis } from 'ioredis';
import { audit } from '@/lib/audit';

/**
 * Fixed-window rate limiting (Prompt 20). Node-runtime only — this module must
 * NEVER be imported by middleware.ts (Edge runtime; ioredis is Node-only).
 * Applied at Node-runtime endpoints: the `signInAction` server action (the
 * primary login path), the auth-route wrapper (defense-in-depth for direct
 * credential POSTs), the attachments Route Handler, and the AI server actions.
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
  // Login uses TWO independent limits (Prompt 6 hardening). The per-IP cap
  // counts REJECTED attempts only — a successful login never consumes it — so a
  // shared campus NAT (hundreds of WILP faculty behind one BITS public IP) can
  // sign in at any rate, while a password-spraying client behind that same IP
  // still runs dry after 30 wrong passwords. The TIGHT per-username cap counts
  // every attempt: it stops targeted brute-force and bounds username
  // enumeration to 5 guesses / account / 15 min.
  loginIp: { limit: 30, windowSec: 15 * 60 }, // 30 REJECTED attempts / 15 min per IP
  loginUser: { limit: 5, windowSec: 15 * 60 }, // 5 attempts / 15 min per username
  upload: { limit: 10, windowSec: 60 * 60 }, // 10 / hour per user
  ai: { limit: 20, windowSec: 60 * 60 }, // 20 / hour per user
} as const;

const degradedOpen = (limit: number): RateLimitResult => ({
  ok: true,
  remaining: limit,
  retryAfterSec: 0,
  degraded: true,
});

/**
 * FAIL OPEN on a Redis error. The audit write has its OWN error boundary so an
 * audit/DB failure during a Redis outage can't propagate up and break the
 * request.
 */
async function failOpen(key: string, limit: number, err: unknown): Promise<RateLimitResult> {
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
  return degradedOpen(limit);
}

/**
 * Retry-After for a blocked key. INCR and EXPIRE are two commands, so a
 * connection drop between them can leave a key with no TTL that would block
 * forever (a whole campus NAT, in the login case). Such a key gets its window
 * here, so every block is bounded by one window.
 */
async function blockedFor(redis: Redis, k: string, windowSec: number): Promise<number> {
  const ttl = await redis.ttl(k);
  if (ttl === -1) {
    await redis.expire(k, windowSec);
    return windowSec;
  }
  return ttl > 0 ? ttl : windowSec;
}

/**
 * Fixed-window counter. `key` is caller-namespaced (e.g. `login:ip:1.2.3.4`,
 * `ai:<userId>`). INCR is atomic (Redis single-threaded); EXPIRE is set only
 * on the first hit of a window so the window doesn't slide.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redis = getClient();
  if (!redis) {
    // Redis not configured — fail open (dev without REDIS_URL).
    return degradedOpen(limit);
  }
  try {
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSec);
    if (count > limit) {
      return { ok: false, remaining: 0, retryAfterSec: await blockedFor(redis, k, windowSec) };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSec: 0 };
  } catch (err) {
    return failOpen(key, limit, err);
  }
}

/**
 * READ-ONLY check of a fixed-window counter that something else advances (the
 * login flow records only rejected attempts). Blocks once the count has
 * REACHED `limit`: `limit` recorded hits are tolerated, the next attempt is
 * not. Same fail-open contract as rateLimit(). GET-then-INCR is not atomic, so
 * a burst of concurrent attempts can overshoot by the burst width — acceptable
 * for a brute-force cap; a sequential attacker is never under-blocked.
 */
export async function peekRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redis = getClient();
  if (!redis) return degradedOpen(limit);
  try {
    const k = `rl:${key}`;
    const raw = Number(await redis.get(k));
    const count = Number.isFinite(raw) ? raw : 0;
    if (count >= limit) {
      return { ok: false, remaining: 0, retryAfterSec: await blockedFor(redis, k, windowSec) };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSec: 0 };
  } catch (err) {
    return failOpen(key, limit, err);
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

const loginIpKey = (ip: string): string => `login:ip:${ip}`;
const loginUserKey = (email: string): string => `login:user:${email.trim().toLowerCase()}`;

/**
 * Login rate limit (Prompt 6): per-IP AND per-username; either tripping blocks.
 * The per-IP counter is only READ here — it advances solely through
 * recordLoginFailure(), after authorize() rejected the credentials — so
 * legitimate logins from a shared NAT never spend it. The per-username counter
 * is advanced on every attempt (and cleared by clearLoginUsername() on
 * success). Returns a single `ok` so the caller can't reveal WHICH limit fired
 * — the generic "too many attempts" message must not leak the vector to a
 * prober. Email is lowercased/trimmed so `Foo@x` and `foo@x` share a counter.
 */
export async function loginRateLimit(
  ip: string,
  email: string,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const [ipRes, userRes] = await Promise.all([
    loginIpRateLimit(ip),
    rateLimit(loginUserKey(email), RATE_LIMITS.loginUser.limit, RATE_LIMITS.loginUser.windowSec),
  ]);
  if (!ipRes.ok || !userRes.ok) {
    return { ok: false, retryAfterSec: Math.max(ipRes.retryAfterSec, userRes.retryAfterSec) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** The per-IP half of loginRateLimit() on its own (read-only), for a login
 * attempt that carries no username. */
export async function loginIpRateLimit(ip: string): Promise<RateLimitResult> {
  return peekRateLimit(loginIpKey(ip), RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.windowSec);
}

/**
 * Record a REJECTED login attempt against the per-IP counter — the only way it
 * advances. Call it after authorize() said no, never before. Best-effort:
 * rateLimit()'s fail-open path applies, so a Redis outage loses the count
 * rather than the request.
 */
export async function recordLoginFailure(ip: string): Promise<void> {
  await rateLimit(loginIpKey(ip), RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.windowSec);
}

/**
 * On a SUCCESSFUL login, clear the per-username counter so a legitimate user
 * isn't left in a hostile state. The per-IP counter is not touched: a valid
 * login never spent it, and it must not refund the rejected attempts of an
 * attacker behind the same NAT.
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
