/**
 * Per-1k-token pricing (USD). Canonical source for AI cost calculation
 * (/admin/ai-metrics + the AiUsageLog cost ledger). These are published list
 * prices — review periodically; when a provider changes pricing, update the
 * value here AND the "verified" date below. Past AiUsageLog rows keep the cost
 * recorded at call time — NEVER recompute historical costs at new rates.
 *
 * Verified 2026-06-11:
 *   - claude-haiku-4-5: $1/M in, $5/M out  (platform.claude.com/docs pricing) — matches.
 *   - gpt-4o-mini: $0.15/M in, $0.60/M out  (OpenAI list price) — matches.
 *   - text-embedding-3-small: $0.02/M in, $0 out — matches.
 */
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'text-embedding-3-small': { in: 0.00002, out: 0 },
  'claude-haiku-4-5-20251001': { in: 0.001, out: 0.005 },
};

export function estimateCostUsd(model: string, tokens: { in: number; out: number }): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (tokens.in / 1000) * p.in + (tokens.out / 1000) * p.out;
}
