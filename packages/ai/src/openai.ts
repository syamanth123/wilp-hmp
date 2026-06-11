import OpenAI from 'openai';
import type { AiClient, ChatJsonInput, ChatJsonResult } from './client';

const CHAT_MODEL = 'gpt-4o-mini';
const EMBED_MODEL = 'text-embedding-3-small';

export function createOpenAiClient(apiKey: string): AiClient {
  const sdk = new OpenAI({ apiKey });

  return {
    provider: 'openai',
    chatModel: CHAT_MODEL,
    embedModel: EMBED_MODEL,

    async embedText(input: string) {
      const res = await sdk.embeddings.create({ model: EMBED_MODEL, input });
      const vector = res.data[0]?.embedding;
      if (!vector) throw new Error('openai_embedding_empty');
      // Surface token usage so embedding cost can be tracked (Prompt 17).
      // Embeddings have no output tokens; only prompt_tokens are billed.
      return {
        vector,
        model: EMBED_MODEL,
        tokens: { in: res.usage?.prompt_tokens ?? 0, out: 0 },
      };
    },

    async chatJson<T>(opts: ChatJsonInput<T>): Promise<ChatJsonResult<T>> {
      const res = await sdk.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? '{}';
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('openai_invalid_json');
      }
      const data = opts.schema.parse(parsed);
      return {
        data,
        tokens: {
          in: res.usage?.prompt_tokens ?? 0,
          out: res.usage?.completion_tokens ?? 0,
        },
        model: CHAT_MODEL,
      };
    },
  };
}
