import { Redis } from 'ioredis';

/**
 * Lazy singleton ioredis connection for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connection (it manages
 * its own retry/blocking semantics). We don't connect until first use so that
 * importing the queue package (e.g. for enqueue helpers or type definitions)
 * never opens a socket — the synchronous notification fallback path must work
 * with no Redis at all.
 */
let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set — cannot create a Redis connection for BullMQ.');
  }
  connection = new Redis(url, {
    maxRetriesPerRequest: null,
    // Don't spam reconnect attempts forever in short-lived contexts (tests).
    enableReadyCheck: true,
  });
  return connection;
}

/** Closes the shared connection (used by the worker's graceful shutdown and tests). */
export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}

/** True when REDIS_URL is configured. Cheap check used by the enqueue boundary. */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}
