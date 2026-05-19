import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { prisma } from '@hmp/db';
import { getAiClient } from '@hmp/ai';
import { ReEmbedPanel } from './re-embed-panel';

export const dynamic = 'force-dynamic';

function startOfDayUtc(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function AiMetricsPage() {
  const client = getAiClient();
  const provider = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
  const openaiSet = Boolean(process.env.OPENAI_API_KEY);
  const anthropicSet = Boolean(process.env.ANTHROPIC_API_KEY);
  const since = startOfDayUtc(13);

  const [recs, reports, drafts, draftsLifetime, embeddings, lastError] = await Promise.all([
    prisma.aIRecommendation.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, model: true },
    }),
    prisma.aIQualityReport.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, model: true, score: true },
    }),
    prisma.aIDraftLog.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, model: true, source: true },
    }),
    prisma.aIDraftLog.count(),
    prisma.embedding.groupBy({
      by: ['ownerType', 'model'],
      _count: { _all: true },
    }),
    prisma.auditLog.findFirst({
      where: { action: { startsWith: 'ai.' }, after: { not: undefined } },
      orderBy: { createdAt: 'desc' },
      select: { action: true, createdAt: true, after: true },
    }),
  ]);

  // Per-day buckets (last 14 days).
  const dayBuckets = new Map<
    string,
    { recs: number; reports: number; drafts: number; models: Set<string> }
  >();
  for (let i = 13; i >= 0; i--) {
    dayBuckets.set(dayKey(startOfDayUtc(i)), {
      recs: 0,
      reports: 0,
      drafts: 0,
      models: new Set(),
    });
  }
  for (const r of recs) {
    const key = dayKey(r.createdAt);
    const b = dayBuckets.get(key);
    if (b) {
      b.recs += 1;
      b.models.add(r.model);
    }
  }
  for (const r of reports) {
    const key = dayKey(r.createdAt);
    const b = dayBuckets.get(key);
    if (b) {
      b.reports += 1;
      b.models.add(r.model);
    }
  }
  for (const d of drafts) {
    const key = dayKey(d.createdAt);
    const b = dayBuckets.get(key);
    if (b) {
      b.drafts += 1;
      b.models.add(d.model);
    }
  }

  const totalRecs = recs.length;
  const totalReports = reports.length;
  const totalDrafts = drafts.length;
  const avgScore =
    reports.length === 0
      ? null
      : reports.reduce((s, r) => s + r.score, 0) / reports.length;

  // Group embeddings by ownerType for a compact summary.
  const embedByOwner = new Map<string, { count: number; models: Set<string> }>();
  for (const e of embeddings) {
    const row = embedByOwner.get(e.ownerType) ?? { count: 0, models: new Set<string>() };
    row.count += e._count._all;
    row.models.add(e.model);
    embedByOwner.set(e.ownerType, row);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Provider status</CardTitle>
          <CardDescription>
            Configure via <code className="font-mono text-xs">AI_PROVIDER</code> +{' '}
            <code className="font-mono text-xs">OPENAI_API_KEY</code> /{' '}
            <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>. Without keys the system
            falls back to heuristic-only recommendations and disabled quality checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Active provider</div>
            <div className="text-lg font-semibold">
              {client.provider === 'noop' ? (
                <Badge variant="destructive">Not configured ({provider})</Badge>
              ) : (
                <Badge variant="success">{client.provider}</Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              chat: {client.chatModel} · embed: {client.embedModel}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">OPENAI_API_KEY</div>
            <Badge variant={openaiSet ? 'success' : 'secondary'}>
              {openaiSet ? 'set' : 'missing'}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground">ANTHROPIC_API_KEY</div>
            <Badge variant={anthropicSet ? 'success' : 'secondary'}>
              {anthropicSet ? 'set' : 'missing'}
            </Badge>
          </div>
          {lastError && (
            <div className="sm:col-span-3">
              <div className="text-muted-foreground">Last AI audit entry</div>
              <div className="font-mono text-xs">
                {lastError.action} · {new Date(lastError.createdAt).toLocaleString()}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage (last 14 days)</CardTitle>
          <CardDescription>
            {totalRecs} recommendation run(s) · {totalReports} quality report(s) · {totalDrafts}{' '}
            draft(s) generated
            {avgScore !== null && ` · avg score ${(avgScore * 100).toFixed(0)}/100`}
            {' · '}
            <span className="font-mono">lifetime drafts: {draftsLifetime}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Recommendations</TableHead>
                <TableHead>Quality reports</TableHead>
                <TableHead>Drafts generated</TableHead>
                <TableHead>Models used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(dayBuckets.entries()).map(([day, b]) => (
                <TableRow key={day}>
                  <TableCell className="font-mono text-xs">{day}</TableCell>
                  <TableCell>{b.recs}</TableCell>
                  <TableCell>{b.reports}</TableCell>
                  <TableCell>{b.drafts}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {Array.from(b.models).map((m) => (
                      <Badge key={m} variant="secondary" className="font-mono text-xs">
                        {m}
                      </Badge>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Per-call token counts are not persisted yet — cost rollup will be added once the AI
            provider returns and we capture token usage per request.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embedding corpus</CardTitle>
          <CardDescription>
            Embeddings are computed on-demand and cached in the <code>Embedding</code> table.
            Re-embed when course descriptions or faculty histories change materially.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {embedByOwner.size === 0 ? (
            <p className="text-sm text-muted-foreground">No embeddings stored yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner type</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Models</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(embedByOwner.entries()).map(([owner, row]) => (
                  <TableRow key={owner}>
                    <TableCell>{owner}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell className="flex flex-wrap gap-1">
                      {Array.from(row.models).map((m) => (
                        <Badge key={m} variant="secondary" className="font-mono text-xs">
                          {m}
                        </Badge>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <ReEmbedPanel />
        </CardContent>
      </Card>
    </div>
  );
}
