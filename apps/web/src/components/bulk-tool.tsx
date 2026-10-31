import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';

/**
 * Bulk tools for HOG and PC: one hub page per role (/hog/bulk, /pc/bulk) and
 * one shared layout for each bulk page. Every tool says in one sentence what
 * it does, offers its template, and links back to the dashboard. Column and
 * action names appear in code style only inside "How to fill the template".
 */

export interface BulkTool {
  title: string;
  sentence: string;
  href: string;
  templateHref: string;
  testId: string;
}

export const BULK_TOOLS: Record<'HOG' | 'PC', BulkTool[]> = {
  HOG: [
    {
      title: 'Bulk allocate faculty (upload)',
      sentence:
        'Allocate faculty and a subject expert to many new requests at once from one spreadsheet.',
      href: '/hog/requests/bulk-allocate',
      templateHref: '/hog/requests/bulk-allocate/template',
      testId: 'bulk-tool-hog-allocate',
    },
    {
      title: 'Bulk review handouts',
      sentence: 'Give final approval, ask for changes or reject many handouts at once.',
      href: '/hog/bulk-review',
      templateHref: '/hog/bulk-review/template',
      testId: 'bulk-tool-hog-review',
    },
  ],
  PC: [
    {
      title: 'Bulk confirm allocations (upload)',
      sentence: 'Confirm, or send back to the Head of Group, many faculty allocations at once.',
      href: '/pc/allocation-review',
      templateHref: '/pc/allocation-review/template',
      testId: 'bulk-tool-pc-allocation',
    },
    {
      title: 'Bulk review handouts',
      sentence: 'Approve and forward, or ask for changes on, many submitted handouts at once.',
      href: '/pc/bulk-review',
      templateHref: '/pc/bulk-review/template',
      testId: 'bulk-tool-pc-review',
    },
  ],
};

function BackToDashboard({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="text-primary text-sm underline-offset-4 hover:underline"
      data-testid="back-to-dashboard"
    >
      ← Back to dashboard
    </Link>
  );
}

export function BulkToolsHub({ role }: { role: 'HOG' | 'PC' }) {
  const dashboard = role === 'HOG' ? '/hog' : '/pc';
  return (
    <div className="space-y-4">
      <BackToDashboard href={dashboard} />
      <div>
        <h1 className="text-2xl font-semibold">Bulk tools</h1>
        <p className="text-muted-foreground text-sm">
          Do the same step for many requests at once by uploading one spreadsheet (CSV).
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {BULK_TOOLS[role].map((t) => (
          <Card key={t.href} data-testid={t.testId}>
            <CardHeader>
              <CardTitle className="text-base">{t.title}</CardTitle>
              <CardDescription>{t.sentence}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href={t.href} className={buttonVariants({ size: 'sm' })}>
                Open
              </Link>
              <a
                href={t.templateHref}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                download
              >
                Download template
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function BulkToolPage({
  title,
  sentence,
  templateHref,
  dashboardHref,
  help,
  children,
}: {
  title: string;
  sentence: string;
  templateHref: string;
  dashboardHref: string;
  help: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <BackToDashboard href={dashboardHref} />
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{sentence}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href={templateHref}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download template
          </a>
          <details className="rounded-md border p-3 text-sm" data-testid="bulk-help">
            <summary className="cursor-pointer font-medium">How to fill the template</summary>
            <div className="mt-2 space-y-2">
              {help}
              <p className="text-muted-foreground">
                Lines starting with <code>#</code> are examples and are ignored. The whole file is
                checked first: if any row has a problem, nothing is saved and every problem is
                listed. Row numbers in those messages count the header as row 1 and skip the example
                lines.
              </p>
            </div>
          </details>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
