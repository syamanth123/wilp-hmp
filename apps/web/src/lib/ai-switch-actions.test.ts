import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every AI server action refuses while AI_FEATURES_ENABLED is off — before it
// touches the database, the AI provider or a queue — and goes past the switch
// when it is on. Heavy dependencies are replaced by stubs that only record
// that they were reached, so no database or AI provider is needed.

const reached = vi.hoisted(() => ({ count: 0 }));

vi.mock('@hmp/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const touch = (): never => {
    reached.count++;
    throw new Error('DB_REACHED');
  };
  const model = new Proxy({}, { get: () => touch });
  const prisma = new Proxy({}, { get: () => model });
  return { ...actual, prisma };
});

vi.mock('@hmp/auth', () => {
  const user = {
    id: 'u1',
    email: 'u1@example.com',
    name: 'Test User',
    roles: ['ADMIN', 'FACULTY', 'HOG', 'SME', 'INSTRUCTION_CELL', 'PROGRAMME_COMMITTEE'],
  };
  return { getSessionUser: async () => user, requireRole: () => user };
});

vi.mock('@hmp/ai', () => {
  const hit = async () => {
    reached.count++;
    throw new Error('AI_REACHED');
  };
  class AiUnconfiguredError extends Error {}
  return {
    AiUnconfiguredError,
    runQualityReport: hit,
    generateHandoutDraft: hit,
    generateStructuredHandoutDraft: hit,
    recommendFaculty: hit,
    clearTodayRecommendations: hit,
    ensureCorpusEmbeddings: hit,
  };
});

vi.mock('@hmp/queue', () => {
  const queue = {
    getJob: async () => {
      reached.count++;
      throw new Error('QUEUE_REACHED');
    },
  };
  return { getAiQueue: () => queue, getNotificationsQueue: () => queue, enqueueAiJob: vi.fn() };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ ok: true }),
  RATE_LIMITS: { ai: { limit: 100, windowSec: 60 } },
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notifyTransition: vi.fn() }));

import { AI_OFF_MESSAGE } from './features';
import { runQualityCheckAction } from '../app/faculty/assignments/[id]/actions';
import {
  generateAiDraftAction,
  applyAiDraftAction,
} from '../app/faculty/assignments/[id]/ai-actions';
import {
  generateStructuredAiDraftAction,
  applyStructuredAiDraftAction,
} from '../app/faculty/assignments/[id]/structured-actions';
import { regenerateRecommendationAction } from '../app/hog/requests/[id]/actions';
import { runReEmbedAction } from '../app/admin/ai-metrics/actions';
import { retryFailedJobAction, deleteFailedJobAction } from '../app/admin/queues/actions';

const CUID = 'ckabcdefghijklmnopqrstuvw';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ACTIONS: Array<[string, () => Promise<unknown>]> = [
  ['runQualityCheckAction', () => runQualityCheckAction(form({ requestId: CUID }))],
  ['generateAiDraftAction', () => generateAiDraftAction(form({ requestId: CUID }))],
  ['applyAiDraftAction', () => applyAiDraftAction(form({ requestId: CUID, draftId: CUID }))],
  [
    'generateStructuredAiDraftAction',
    () => generateStructuredAiDraftAction(form({ requestId: CUID })),
  ],
  [
    'applyStructuredAiDraftAction',
    () => applyStructuredAiDraftAction(form({ requestId: CUID, draftId: CUID })),
  ],
  [
    'regenerateRecommendationAction',
    () => regenerateRecommendationAction(form({ requestId: CUID })),
  ],
  ['runReEmbedAction', () => runReEmbedAction()],
  [
    'retryFailedJobAction (ai queue)',
    () => retryFailedJobAction(form({ queue: 'ai', jobId: '1' })),
  ],
  [
    'deleteFailedJobAction (ai queue)',
    () => deleteFailedJobAction(form({ queue: 'ai', jobId: '1' })),
  ],
];

const saved = process.env.AI_FEATURES_ENABLED;
beforeEach(() => {
  reached.count = 0;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AI_FEATURES_ENABLED;
  else process.env.AI_FEATURES_ENABLED = saved;
});

describe('AI server actions with AI_FEATURES_ENABLED off', () => {
  for (const [name, call] of ACTIONS) {
    it(`${name} refuses before reaching the database, AI or a queue`, async () => {
      delete process.env.AI_FEATURES_ENABLED;
      await expect(call()).resolves.toEqual({ error: AI_OFF_MESSAGE });
      expect(reached.count).toBe(0);
    });
  }
});

describe('AI server actions with AI_FEATURES_ENABLED on', () => {
  for (const [name, call] of ACTIONS) {
    it(`${name} goes past the switch`, async () => {
      process.env.AI_FEATURES_ENABLED = 'true';
      const result = await call().catch((err: Error) => ({ thrown: err.message }));
      expect(result).not.toEqual({ error: AI_OFF_MESSAGE });
    });
  }
});
