import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAiClient, AiUnconfiguredError, __resetAiClientCache } from './client';

const ENV_KEYS = ['AI_PROVIDER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;

describe('getAiClient', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    __resetAiClientCache();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    __resetAiClientCache();
  });

  it('returns the noop client when no keys are set', async () => {
    const client = getAiClient();
    expect(client.provider).toBe('noop');
    await expect(client.embedText('x')).rejects.toBeInstanceOf(AiUnconfiguredError);
  });

  it('caches the client across calls with the same fingerprint', () => {
    const a = getAiClient();
    const b = getAiClient();
    expect(a).toBe(b);
  });

  it('flips to noop with a different reason when provider=anthropic and no key', () => {
    process.env.AI_PROVIDER = 'anthropic';
    __resetAiClientCache();
    const client = getAiClient();
    expect(client.provider).toBe('noop');
  });
});
