export { getAiClient, AiUnconfiguredError, __resetAiClientCache } from './client';
export type { AiClient, ChatJsonInput, ChatJsonResult } from './client';
export { cosine, embedCourse, embedFaculty, ensureCorpusEmbeddings } from './embeddings';
export { recommendFaculty, clearTodayRecommendations } from './recommender';
export type { RecommendationCandidate, RecommendationResult } from './recommender';
export { runQualityReport, latestQualityReport } from './quality';
export type { QualityReportResult } from './quality';
export { generateHandoutDraft, structuredDraftToTiptap } from './handout-generator';
export type {
  GenerateHandoutDraftInput,
  HandoutDraftResult,
  DraftSource,
} from './handout-generator';
export { generateStructuredHandoutDraft } from './structured-handout-generator';
export type {
  GenerateStructuredHandoutDraftInput,
  StructuredHandoutDraftResult,
  StructuredDraftSource,
} from './structured-handout-generator';
export {
  QualityReportSchema,
  BloomsBucketSchema,
  CoverageSchema,
  HandoutDraftSchema,
} from './schemas';
export type { QualityReportData, BloomsBucket, Coverage, HandoutDraftData } from './schemas';
export { MODEL_PRICING, estimateCostUsd } from './pricing';
export { recordAiUsage, maybeWarnBudget } from './usage';
export type { AiUsageContext, RecordAiUsageInput } from './usage';
