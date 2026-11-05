// The notification bell's live stream (Server-Sent Events). One idempotent cleanup runs whichever
// way the stream ends — the browser goes away (`cancel`), the request is aborted, or the 5-minute
// cut-off — and nothing is written after it. Before v1.3.0 the timers were only cleared on abort,
// which Next 14 doesn't reliably fire, so the heartbeat kept writing to a closed stream and the
// server log filled with "Invalid state: Controller is already closed".

export interface StreamTimings {
  tickMs: number;
  heartbeatMs: number;
  maxRuntimeMs: number;
}

export const STREAM_TIMINGS: StreamTimings = {
  tickMs: 10_000,
  heartbeatMs: 25_000,
  maxRuntimeMs: 5 * 60_000,
};

export function createUnreadStream<T extends { unread: number }>(
  query: () => Promise<T>,
  signal: AbortSignal,
  timings: StreamTimings = STREAM_TIMINGS,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (closeController: boolean) => void = () => {
    closed = true;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(false); // the stream went away under us
        }
      };
      const timers: ReturnType<typeof setTimeout>[] = [];
      cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        timers.forEach((t) => clearTimeout(t));
        signal.removeEventListener('abort', onAbort);
        if (closeController) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      const onAbort = () => cleanup(true);
      // Listen before the first database query, and catch an abort that already happened.
      signal.addEventListener('abort', onAbort);
      if (signal.aborted) return cleanup(true);

      let lastUnread = -1;
      const tick = async () => {
        if (closed) return;
        try {
          const snap = await query();
          if (!closed && snap.unread !== lastUnread) {
            lastUnread = snap.unread;
            write(`event: notification\ndata: ${JSON.stringify(snap)}\n\n`);
          }
        } catch (err) {
          console.error('[notifications/stream] tick failed', err);
        }
      };

      await tick();
      if (closed) return;
      timers.push(setInterval(tick, timings.tickMs));
      timers.push(setInterval(() => write(': ping\n\n'), timings.heartbeatMs));
      timers.push(setTimeout(() => cleanup(true), timings.maxRuntimeMs));
    },
    cancel() {
      cleanup(false);
    },
  });
}
