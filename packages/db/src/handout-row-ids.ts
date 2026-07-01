import type { BitsHandoutV1 } from './handout-schema';

/**
 * Opaque stable-id support for the structured editor's drag-to-reorder
 * (see the `rowId` note in handout-schema.ts).
 *
 * `id` is OPTIONAL in the schema so legacy `HandoutVersion.data` still parses.
 * The editor mints ids lazily on write-mode mount via `backfillRowIds` and
 * persists them on the next save; the renderer ignores `id`, so read paths
 * never need this.
 */

/** Mint one opaque row id. `globalThis.crypto.randomUUID` is available in both
 * the browser (editor client) and Node 19+ (server / tests) — no dependency. */
export function makeRowId(): string {
  return globalThis.crypto.randomUUID();
}

/** Return `row` unchanged if it already has an id; otherwise a copy with a fresh
 * id. Spread-first so an existing id is never clobbered (idempotent). */
function ensureId<T extends { id?: string }>(row: T): T {
  return { ...row, id: row.id ?? makeRowId() };
}

/**
 * Return a structural copy of `data` with a stable `id` on every repeatable
 * row (Part A coded lists, Part B sessions, experiential components +
 * experiments, evaluation components + their sub-components).
 *
 * PURE (no mutation) and IDEMPOTENT: rows that already have an id keep it, so
 * running twice yields the same ids and re-mounting a handout whose rows are
 * all id'd is a structural no-op (the editor's dirty check stays clean). Only
 * genuinely id-less rows change — which is exactly the one-time backfill.
 */
export function backfillRowIds(data: BitsHandoutV1): BitsHandoutV1 {
  return {
    ...data,
    partA: {
      ...data.partA,
      courseObjectives: data.partA.courseObjectives.map(ensureId),
      textBooks: data.partA.textBooks.map(ensureId),
      referenceBooks: data.partA.referenceBooks.map(ensureId),
      learningOutcomes: data.partA.learningOutcomes.map(ensureId),
    },
    partB: {
      ...data.partB,
      sessions: data.partB.sessions.map(ensureId),
    },
    experientialLearning: data.experientialLearning
      ? {
          ...data.experientialLearning,
          components: data.experientialLearning.components.map(ensureId),
          experiments: data.experientialLearning.experiments.map(ensureId),
        }
      : data.experientialLearning,
    evaluation: {
      ...data.evaluation,
      components: data.evaluation.components.map((c) => ({
        ...ensureId(c),
        subComponents: c.subComponents.map(ensureId),
      })),
    },
  };
}
