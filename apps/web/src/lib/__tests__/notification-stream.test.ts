import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUnreadStream } from '../notification-stream';

const T = { tickMs: 1_000, heartbeatMs: 2_500, maxRuntimeMs: 30_000 };
const decode = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join('');

describe('notification stream ends cleanly', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function drain(stream: ReadableStream<Uint8Array>, chunks: Uint8Array[]) {
    const reader = stream.getReader();
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (done) return;
        chunks.push(value!);
      }
    })();
    return reader;
  }

  it('sends the count, pings, and stops everything when the browser goes away', async () => {
    const query = vi.fn(async () => ({ unread: 2 }));
    const chunks: Uint8Array[] = [];
    const reader = await drain(createUnreadStream(query, new AbortController().signal, T), chunks);
    await vi.advanceTimersByTimeAsync(2_600);
    expect(decode(chunks)).toContain('event: notification');
    expect(decode(chunks)).toContain(': ping');
    const calls = query.mock.calls.length;

    await reader.cancel(); // the browser closed the page
    const errors = vi.spyOn(console, 'error');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(query.mock.calls.length).toBe(calls); // no more database queries
    expect(vi.getTimerCount()).toBe(0); // every timer cleared
    expect(errors).not.toHaveBeenCalled();
  });

  it('an abort during the first query closes the stream without starting any timer', async () => {
    const ac = new AbortController();
    let finish!: () => void;
    const query = vi.fn(
      () => new Promise<{ unread: number }>((r) => (finish = () => r({ unread: 1 }))),
    );
    const chunks: Uint8Array[] = [];
    await drain(createUnreadStream(query, ac.signal, T), chunks);
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(decode(chunks)).not.toContain('event: notification');
  });

  it('the 5-minute cut-off closes once; nothing is written after it', async () => {
    const query = vi.fn(async () => ({ unread: 0 }));
    const chunks: Uint8Array[] = [];
    await drain(createUnreadStream(query, new AbortController().signal, T), chunks);
    await vi.advanceTimersByTimeAsync(T.maxRuntimeMs + 1);
    const written = chunks.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chunks.length).toBe(written);
    expect(vi.getTimerCount()).toBe(0);
  });
});
