/**
 * Per-1k-token pricing (USD). Used by /admin/ai-metrics to estimate cost.
 * Numbers are approximate published list prices and should be reviewed periodically.
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
