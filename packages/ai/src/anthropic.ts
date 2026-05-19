import Anthropic from '@anthropic-ai/sdk';
import type { AiClient, ChatJsonInput, ChatJsonResult } from './client';
import { AiUnconfiguredError } from './client';

const CHAT_MODEL = 'claude-haiku-4-5-20251001';

export function createAnthropicClient(apiKey: string): AiClient {
  const sdk = new Anthropic({ apiKey });

  return {
    provider: 'anthropic',
    chatModel: CHAT_MODEL,
    embedModel: 'unsupported',

    async embedText() {
      // Anthropic does not ship a public embeddings API. Recommender falls back to heuristic mode.
      throw new AiUnconfiguredError('anthropic_no_embeddings');
    },

    async chatJson<T>(opts: ChatJsonInput<T>): Promise<ChatJsonResult<T>> {
      const res = await sdk.messages.create({
        model: CHAT_MODEL,
        max_tokens: opts.maxTokens ?? 1500,
        temperature: 0.2,
        system: `${opts.system}\n\nRespond with a single JSON object only. Do not wrap it in markdown or commentary.`,
        messages: [{ role: 'user', content: opts.user }],
      });
      const block = res.content.find((c) => c.type === 'text');
      const raw = block && block.type === 'text' ? block.text.trim() : '{}';
      const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        throw new Error('anthropic_invalid_json');
      }
      const data = opts.schema.parse(parsed);
      return {
        data,
        tokens: { in: res.usage.input_tokens, out: res.usage.output_tokens },
        model: CHAT_MODEL,
      };
    },
  };
}
