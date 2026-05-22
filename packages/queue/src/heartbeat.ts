import { getRedisConnection } from './connection';

/**
 * Worker liveness via a TTL'd Redis key — the right primitive for "is the
 * worker process running?" without health endpoints or metrics tables.
 *
 * Each worker SETs `queue:heartbeat:{name}` to the current epoch-ms every
 * `INTERVAL_MS`, with a TTL of `TTL_SECONDS`. If the worker dies, the key
 * expires within the TTL window and `readHeartbeat` returns null → the admin
 * UI shows "workers may not be running". A live-but-stale heartbeat (older
 * than the UI's threshold) is also surfaced.
 */
const INTERVAL_MS = 30_000;
const TTL_SECONDS = 90; // 3× the interval — tolerates one missed beat

export function heartbeatKey(name: string): string {
  return `queue:heartbeat:${name}`;
}

/**
 * Starts publishing a heartbeat for `name`. Returns the interval handle — the
 * caller MUST clearInterval() it during graceful shutdown, otherwise the
 * timer keeps the process alive and it won't exit.
 */
export function startHeartbeat(name: string): NodeJS.Timeout {
  const conn = getRedisConnection();
  const beat = () => {
    void conn.set(heartbeatKey(name), String(Date.now()), 'EX', TTL_SECONDS);
  };
  beat(); // emit immediately so status is fresh the moment the worker boots
  return setInterval(beat, INTERVAL_MS);
}

/** Reads the last heartbeat epoch-ms for `name`, or null if absent/expired. */
export async function readHeartbeat(name: string): Promise<number | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const raw = await getRedisConnection().get(heartbeatKey(name));
    if (!raw) return null;
    const ms = Number(raw);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
