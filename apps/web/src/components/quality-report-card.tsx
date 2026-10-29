import { latestQualityReport } from '@hmp/ai';
import { aiFeaturesEnabled } from '@/lib/features';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';

const BLOOM_LABELS: Array<{ key: keyof QualityBlooms; label: string }> = [
  { key: 'remember', label: 'Remember' },
  { key: 'understand', label: 'Understand' },
  { key: 'apply', label: 'Apply' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'evaluate', label: 'Evaluate' },
  { key: 'create', label: 'Create' },
];

type QualityBlooms = {
  remember: number;
  understand: number;
  apply: number;
  analyze: number;
  evaluate: number;
  create: number;
};

export async function QualityReportCard({ handoutId }: { handoutId: string }) {
  // AI switched off (AI_FEATURES_ENABLED): show nothing, query nothing.
  if (!aiFeaturesEnabled()) return null;
  const report = await latestQualityReport(handoutId);
  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI quality report</CardTitle>
          <CardDescription>No quality report yet for this handout.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const blooms = report.blooms as QualityBlooms;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>AI quality report</CardTitle>
          <CardDescription>
            Latest run · {report.model} · {new Date(report.createdAt).toLocaleString()}
          </CardDescription>
        </div>
        <Badge
          variant={
            report.score >= 0.7 ? 'success' : report.score >= 0.4 ? 'secondary' : 'destructive'
          }
        >
          score {(report.score * 100).toFixed(0)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Bloom's distribution
          </div>
          <div className="space-y-1">
            {BLOOM_LABELS.map(({ key, label }) => {
              const value = blooms[key] ?? 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-24 text-xs">{label}</span>
                  <div className="bg-muted h-2 flex-1 rounded">
                    <div
                      className="bg-primary h-2 rounded"
                      style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-10 text-right text-xs">
                    {(value * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Syllabus coverage · {(report.coverage.coverageRatio * 100).toFixed(0)}%
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-emerald-700">Covered</div>
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {report.coverage.covered.length === 0 && <li>None detected</li>}
                {report.coverage.covered.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium text-amber-700">Missing</div>
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {report.coverage.missing.length === 0 && <li>None</li>}
                {report.coverage.missing.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Suggestions
          </div>
          <pre className="bg-muted/40 whitespace-pre-wrap rounded-md p-2 text-xs">
            {report.suggestions}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
