import type { ZodSchema } from 'zod';

export class AiUnconfiguredError extends Error {
  constructor(public readonly reason: string) {
    super(`AI provider unconfigured: ${reason}`);
    this.name = 'AiUnconfiguredError';
  }
}

export interface ChatJsonInput<T> {
  system: string;
  user: string;
  schema: ZodSchema<T>;
  maxTokens?: number;
}

export interface ChatJsonResult<T> {
  data: T;
  tokens: { in: number; out: number };
  model: string;
}

export interface AiClient {
  readonly provider: 'openai' | 'anthropic' | 'noop';
  readonly chatModel: string;
  readonly embedModel: string;
  embedText(
    input: string,
  ): Promise<{ vector: number[]; model: string; tokens?: { in: number; out: number } }>;
  chatJson<T>(input: ChatJsonInput<T>): Promise<ChatJsonResult<T>>;
}

let cached: { client: AiClient; fingerprint: string } | null = null;

function readEnv() {
  return {
    provider: (process.env.AI_PROVIDER ?? 'openai').toLowerCase(),
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  };
}

export function getAiClient(): AiClient {
  const env = readEnv();
  const fp = `${env.provider}|${env.openaiKey ? '1' : '0'}|${env.anthropicKey ? '1' : '0'}`;
  if (cached && cached.fingerprint === fp) return cached.client;

  let client: AiClient;
  if (env.provider === 'anthropic' && env.anthropicKey) {
    // Lazy-loaded so missing peer dep doesn't crash boot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
    const { createAnthropicClient } = require('./anthropic') as typeof import('./anthropic');
    client = createAnthropicClient(env.anthropicKey);
  } else if (env.provider === 'openai' && env.openaiKey) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
    const { createOpenAiClient } = require('./openai') as typeof import('./openai');
    client = createOpenAiClient(env.openaiKey);
  } else {
    client = createNoopClient(
      env.provider === 'anthropic' ? 'anthropic_key_missing' : 'openai_key_missing',
    );
  }
  cached = { client, fingerprint: fp };
  return client;
}

function createNoopClient(reason: string): AiClient {
  return {
    provider: 'noop',
    chatModel: 'none',
    embedModel: 'none',
    async embedText() {
      throw new AiUnconfiguredError(reason);
    },
    async chatJson() {
      throw new AiUnconfiguredError(reason);
    },
  };
}

/** Test-only — flushes the cache between unit tests. */
export function __resetAiClientCache() {
  cached = null;
}
