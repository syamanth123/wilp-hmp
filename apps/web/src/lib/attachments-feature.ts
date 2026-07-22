/**
 * Attachments deferred for launch per scope decision (Prompt 6 hardening).
 *
 * The spec sheet committed "handouts only, no attachments" to IT — enabling
 * attachments changes S3 sizing (~5 GB Year-1 → GB-TB scale), cost, and the
 * vendor quote, so it's not a silent flip. The full implementation (upload
 * route, delete action, S3 wiring) is PRESERVED, not deleted — re-enable by
 * setting this to `false` and restoring the faculty page's `canUpload` when
 * attachments are re-scoped. See deploy/README.md "Post-launch scope
 * re-enablement".
 *
 * Typed `boolean` (not the literal `true`) so the preserved code paths behind
 * the guard don't read as statically unreachable.
 */
export const ATTACHMENTS_DISABLED: boolean = true;
