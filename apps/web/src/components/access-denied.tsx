import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';

/**
 * Friendly "no access" page body. Shown instead of the content when the
 * signed-in user may not see it. Says what happened and where to go next;
 * never reveals anything about the thing they tried to open.
 */
export function AccessDenied({
  reason = 'This page is not available for your account.',
}: {
  reason?: string;
}) {
  return (
    <Card data-testid="access-denied">
      <CardHeader>
        <CardTitle>You don&apos;t have access to this page</CardTitle>
        <CardDescription>{reason}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          If you think you should have access, ask the Instruction Cell or the administrator.{' '}
          <Link href="/" className="underline">
            Go to your home page
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
