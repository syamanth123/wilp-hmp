/**
 * Where a request opens for each role. Used wherever a request is linked from
 * a shared widget (e.g. Recent activity on every dashboard), so a HOG, PC,
 * SME or faculty member never lands on another role's page (which refuses
 * them).
 */
export type ViewerRole = 'IC' | 'HOG' | 'PC' | 'FACULTY' | 'SME' | 'ADMIN';

export function requestHref(role: ViewerRole, requestId: string): string {
  switch (role) {
    case 'HOG':
      return `/hog/requests/${requestId}`;
    case 'PC':
      return `/pc/requests/${requestId}`;
    case 'FACULTY':
      return `/faculty/assignments/${requestId}`;
    case 'SME':
      return `/sme/review/${requestId}`;
    case 'IC':
    case 'ADMIN':
    default:
      return `/ic/requests/${requestId}`;
  }
}
