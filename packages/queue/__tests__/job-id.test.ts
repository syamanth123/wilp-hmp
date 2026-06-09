import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { notifyJobId, type NotifyJob } from '../src/job-types';
import { wrapProcessor, PermanentJobError } from '../src/worker-factory';

const actor = { id: 'u1', name: 'Dr. X' };

// Pure-logic tests — no Redis. Always run.

describe('notifyJobId — dedup key construction', () => {
  it('keys comment jobs on the unique commentId', () => {
    const job: NotifyJob = { kind: 'comment', requestId: 'r1', commentId: 'c1', actor };
    expect(notifyJobId(job)).toBe('notify:comment:c1');
  });

  it('keys manually_published on requestId (published once)', () => {
    expect(notifyJobId({ kind: 'manually_published', requestId: 'r1', actor })).toBe(
      'notify:manually_published:r1',
    );
  });

  it('makes two distinct transitions on the same request DISTINCT (rework loop)', () => {
    // The bug to avoid: a naive requestId+event key would collapse two real
    // SUBMITTED events across a rework cycle into one notification.
    const first: NotifyJob = {
      kind: 'transition',
      requestId: 'r1',
      event: 'SUBMITTED',
      actor,
      occurredAtMs: 1000,
    };
    const second: NotifyJob = {
      kind: 'transition',
      requestId: 'r1',
      event: 'SUBMITTED',
      actor,
      occurredAtMs: 2000,
    };
    expect(notifyJobId(first)).not.toBe(notifyJobId(second));
  });

  it('keeps an identical transition occurrence stable (idempotent re-enqueue)', () => {
    const job: NotifyJob = {
      kind: 'transition',
      requestId: 'r1',
      event: 'PUBLISHED',
      actor,
      occurredAtMs: 5000,
    };
    expect(notifyJobId(job)).toBe(notifyJobId({ ...job }));
  });

  it('keys export_ready per occurrence so re-exports each notify', () => {
    const a = notifyJobId({
      kind: 'publish_export_ready',
      requestId: 'r1',
      actor,
      occurredAtMs: 1,
    });
    const b = notifyJobId({
      kind: 'publish_export_ready',
      requestId: 'r1',
      actor,
      occurredAtMs: 2,
    });
    expect(a).not.toBe(b);
  });
});

describe('wrapProcessor — transient vs permanent classification', () => {
  const fakeJob = { id: 'j1' } as Job<unknown>;

  it('maps PermanentJobError → UnrecoverableError (no retry)', async () => {
    const wrapped = wrapProcessor(async () => {
      throw new PermanentJobError('missing template');
    });
    await expect(wrapped(fakeJob, 'tok')).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('re-throws a transient error unchanged (retryable)', async () => {
    const transient = new Error('SMTP temporarily unavailable');
    const wrapped = wrapProcessor(async () => {
      throw transient;
    });
    await expect(wrapped(fakeJob, 'tok')).rejects.toBe(transient);
  });

  it('passes through on success', async () => {
    const inner = vi.fn(async () => undefined);
    const wrapped = wrapProcessor(inner);
    await expect(wrapped(fakeJob, 'tok')).resolves.toBeUndefined();
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
