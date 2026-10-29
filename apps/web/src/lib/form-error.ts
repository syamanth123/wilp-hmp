import type { ZodError, ZodIssue } from 'zod';

/**
 * Plain-words form errors. Server actions used to return Zod's own wording
 * ("String must contain at least 2 character(s)", "Invalid cuid") or a bare
 * "Invalid input". Messages a schema sets on purpose are kept as written;
 * Zod's defaults become one sentence that names the field and says what to do.
 */

/** For problems the user can't fix in the form (a stale page, a bad link). */
export const GENERIC_ERROR = 'Something went wrong — refresh the page and try again.';

/** Ids and other fields the page fills in itself: a problem there is never the user's. */
const HIDDEN_FIELDS = /(^id$|Id$|^ids?$|requestId|draftId|jobId|termId|importId)/;

function fieldName(issue: ZodIssue, labels: Record<string, string>): string {
  const key = issue.path.join('.');
  const last = String(issue.path[issue.path.length - 1] ?? '');
  if (labels[key]) return labels[key]!;
  if (labels[last]) return labels[last]!;
  if (!last) return 'This field';
  const words = last
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ZOD_DEFAULT =
  /^(Required|Invalid input|Invalid (email|url|uuid|cuid2?|date|datetime|enum value|literal value|type).*|Expected .*|String must contain .*|Number must be .*|Array must contain .*|Invalid string.*)$/;

export function plainIssue(issue: ZodIssue, labels: Record<string, string> = {}): string {
  if (!ZOD_DEFAULT.test(issue.message)) return issue.message; // the schema's own words
  const key = String(issue.path[issue.path.length - 1] ?? '');
  if (HIDDEN_FIELDS.test(key) && !labels[key]) return GENERIC_ERROR;
  const name = fieldName(issue, labels);
  switch (issue.code) {
    case 'invalid_string':
      if (issue.validation === 'email') return `${name}: enter a valid email address.`;
      if (issue.validation === 'url')
        return `${name}: enter a full web address starting with https://`;
      return `${name} isn't in the right format.`;
    case 'too_small':
      if (issue.type === 'string')
        return Number(issue.minimum) <= 1
          ? `${name} is required.`
          : `${name} must be at least ${issue.minimum} characters.`;
      if (issue.type === 'number') return `${name} must be at least ${issue.minimum}.`;
      if (issue.type === 'array')
        return `Choose at least ${issue.minimum} for ${name.toLowerCase()}.`;
      return `${name} is too short.`;
    case 'too_big':
      if (issue.type === 'string') return `${name} must be at most ${issue.maximum} characters.`;
      if (issue.type === 'number') return `${name} must be ${issue.maximum} or less.`;
      return `${name} is too long.`;
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null')
        return `${name} is required.`;
      return `${name} isn't valid.`;
    case 'invalid_enum_value':
      return `Choose one of the options for ${name.toLowerCase()}.`;
    default:
      return `${name} isn't valid.`;
  }
}

/** The first problem in a failed parse, in plain words. */
export function formError(error: ZodError, labels: Record<string, string> = {}): string {
  const first = error.issues[0];
  return first ? plainIssue(first, labels) : GENERIC_ERROR;
}
