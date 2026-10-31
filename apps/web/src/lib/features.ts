/**
 * Feature switches read on the server. One place, so a switch can never be
 * half-applied.
 *
 * AI_FEATURES_ENABLED (default OFF): AI drafting, AI quality checks, faculty
 * recommendations and AI metrics. When off, the UI hides them and the server
 * refuses them; the code and tables stay, so turning it on brings everything
 * back. Fetching last year's handout is NOT an AI feature and is unaffected.
 */
export function aiFeaturesEnabled(): boolean {
  return (process.env.AI_FEATURES_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** What a refused AI action tells the user. */
export const AI_OFF_MESSAGE = 'AI features are switched off on this server.';
