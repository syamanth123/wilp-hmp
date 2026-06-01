import type { BitsHandoutV1 } from '@hmp/db';

/**
 * Pure helpers for the Evaluation Scheme section's UI-only business rule:
 * sub-component weights must sum to 100 across all ECs. The schema (Zod)
 * only constrains each weight to 0-100 individually; the sum-to-100 rule
 * is a BITS convention enforced by the editor at save time.
 *
 * Exported separately so unit tests can verify the math without
 * instantiating React components.
 */

export function evaluationTotalWeight(value: BitsHandoutV1['evaluation']): number {
  return value.components.reduce(
    (sum, ec) =>
      sum + ec.subComponents.reduce((s, sc) => s + (Number.isFinite(sc.weight) ? sc.weight : 0), 0),
    0,
  );
}

export function ecSumWeight(ec: BitsHandoutV1['evaluation']['components'][number]): number {
  return ec.subComponents.reduce((s, sc) => s + (Number.isFinite(sc.weight) ? sc.weight : 0), 0);
}

export function isEvaluationValid(value: BitsHandoutV1['evaluation']): boolean {
  return evaluationTotalWeight(value) === 100;
}
