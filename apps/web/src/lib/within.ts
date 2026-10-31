/**
 * Run `load` but stop waiting after `ms`. Used where a dependency can hang
 * instead of failing — e.g. Redis that is configured but not running, where
 * queue reads wait forever for a connection. The slow work is abandoned, not
 * cancelled; the page simply stops waiting for it.
 */
export type Within<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'error' };

export async function within<T>(load: () => Promise<T>, ms: number): Promise<Within<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Within<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms);
  });
  const run = load().then(
    (value): Within<T> => ({ ok: true, value }),
    (): Within<T> => ({ ok: false, reason: 'error' }),
  );
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
