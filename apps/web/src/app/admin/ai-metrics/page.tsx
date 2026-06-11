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

function startOfUtcMonth(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}

/** Start of the month 5 months back — the 6-month trend window (inclusive). */
function sixMonthWindowStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 5, 1));
}

/** Format USD; admin cost views want sub-cent precision, so default 4 dp. */
function usd(n: number, dp = 4): string {
  return `$${n.toFixed(dp)}`;
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
    reports.length === 0 ? null : reports.reduce((s, r) => s + r.score, 0) / reports.length;

  // Group embeddings by ownerType for a compact summary.
  const embedByOwner = new Map<string, { count: number; models: Set<string> }>();
  for (const e of embeddings) {
    const row = embedByOwner.get(e.ownerType) ?? { count: 0, models: new Set<string>() };
    row.count += e._count._all;
    row.models.add(e.model);
    embedByOwner.set(e.ownerType, row);
  }

  // ── AI cost ledger (Prompt 17). All queries empty-safe — a fresh deploy with
  // an empty AiUsageLog renders $0 / 0 calls / empty tables, never errors. ──
  const monthStart = startOfUtcMonth();
  const budgetUsd =
    Number(process.env.AI_MONTHLY_BUDGET_USD) > 0 ? Number(process.env.AI_MONTHLY_BUDGET_USD) : 200;
  const monthLabel = monthStart.toISOString().slice(0, 7);

  const [monthAgg, byOperation, topUserGroups, topHandoutGroups, monthlyTrend] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['operation'],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { costUsd: 'desc' } },
      take: 10,
    }),
    prisma.aiUsageLog.groupBy({
      by: ['handoutId'],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { costUsd: 'desc' } },
      take: 10,
    }),
    prisma.$queryRaw<Array<{ month: string; cost: number; calls: number }>>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
             COALESCE(SUM("costUsd"), 0)::float8 AS cost,
             COUNT(*)::int AS calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${sixMonthWindowStart()}
      GROUP BY 1
      ORDER BY 1 DESC`,
  ]);

  const monthSpend = Number(monthAgg._sum.costUsd ?? 0);
  const monthCalls = monthAgg._count._all;
  const budgetPct = budgetUsd > 0 ? Math.round((monthSpend / budgetUsd) * 100) : 0;
  const overBudget = monthSpend > budgetUsd;

  // Resolve names/refs for the top-N groups (null FK → orphaned/background).
  const topUserIds = topUserGroups.map((g) => g.userId).filter((x): x is string => Boolean(x));
  const topHandoutIds = topHandoutGroups
    .map((g) => g.handoutId)
    .filter((x): x is string => Boolean(x));
  const [userRows, handoutRows] = await Promise.all([
    topUserIds.length
      ? prisma.user.findMany({
          where: { id: { in: topUserIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    topHandoutIds.length
      ? prisma.handout.findMany({
          where: { id: { in: topHandoutIds } },
          select: { id: true, request: { select: { refNo: true } } },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const handoutRef = new Map(handoutRows.map((h) => [h.id, h.request.refNo]));

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
            <div className="text-muted-foreground mt-1 text-xs">
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
          <CardTitle>AI cost — {monthLabel}</CardTitle>
          <CardDescription>
            Month-to-date spend vs the soft monthly budget (
            <code className="font-mono text-xs">AI_MONTHLY_BUDGET_USD</code>, default $200). Soft
            cap: AI stays enabled when over budget; an admin is notified once per month.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">This month</div>
            <div className="text-2xl font-semibold">{usd(monthSpend, 2)}</div>
            <div className="text-muted-foreground mt-1 text-xs">{monthCalls} call(s)</div>
          </div>
          <div>
            <div className="text-muted-foreground">Budget</div>
            <div className="text-2xl font-semibold">{usd(budgetUsd, 2)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Used</div>
            <div className="text-2xl font-semibold">
              {overBudget ? (
                <Badge variant="destructive">{budgetPct}% — over budget</Badge>
              ) : (
                <Badge variant="success">{budgetPct}%</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost by operation ({monthLabel})</CardTitle>
            <CardDescription>Which features drove spend this month.</CardDescription>
          </CardHeader>
          <CardContent>
            {byOperation.length === 0 ? (
              <p className="text-muted-foreground text-sm">No AI usage recorded this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byOperation
                    .slice()
                    .sort((a, b) => Number(b._sum.costUsd ?? 0) - Number(a._sum.costUsd ?? 0))
                    .map((o) => (
                      <TableRow key={o.operation}>
                        <TableCell className="font-mono text-xs">{o.operation}</TableCell>
                        <TableCell>{o._count._all}</TableCell>
                        <TableCell>{usd(Number(o._sum.costUsd ?? 0))}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly trend (6 months)</CardTitle>
            <CardDescription>Cost + call count per month.</CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length === 0 ? (
              <p className="text-muted-foreground text-sm">No AI usage recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyTrend.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-mono text-xs">{m.month}</TableCell>
                      <TableCell>{m.calls}</TableCell>
                      <TableCell>{usd(Number(m.cost))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top users ({monthLabel})</CardTitle>
            <CardDescription>Highest AI spend by triggering user this month.</CardDescription>
          </CardHeader>
          <CardContent>
            {topUserGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm">No AI usage recorded this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topUserGroups.map((g) => (
                    <TableRow key={g.userId ?? 'system'}>
                      <TableCell>
                        {g.userId ? (
                          (userName.get(g.userId) ?? g.userId)
                        ) : (
                          <span className="text-muted-foreground">system / background</span>
                        )}
                      </TableCell>
                      <TableCell>{g._count._all}</TableCell>
                      <TableCell>{usd(Number(g._sum.costUsd ?? 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top handouts ({monthLabel})</CardTitle>
            <CardDescription>Highest AI spend by handout this month.</CardDescription>
          </CardHeader>
          <CardContent>
            {topHandoutGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm">No AI usage recorded this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Handout</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topHandoutGroups.map((g) => (
                    <TableRow key={g.handoutId ?? 'none'}>
                      <TableCell className="font-mono text-xs">
                        {g.handoutId ? (
                          (handoutRef.get(g.handoutId) ?? g.handoutId)
                        ) : (
                          <span className="text-muted-foreground">— (not handout-scoped)</span>
                        )}
                      </TableCell>
                      <TableCell>{g._count._all}</TableCell>
                      <TableCell>{usd(Number(g._sum.costUsd ?? 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

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
          <p className="text-muted-foreground mt-2 text-xs">
            Counts above are per artifact produced. Per-call token cost is tracked separately in the
            AI cost cards above (one ledger row per real provider call; cache/stub hits are free).
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
            <p className="text-muted-foreground text-sm">No embeddings stored yet.</p>
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
