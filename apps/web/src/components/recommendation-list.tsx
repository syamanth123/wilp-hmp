'use client';

import { useTransition } from 'react';
import { Badge, Button } from '@hmp/ui';
import type { RecommendationResult } from '@hmp/ai';
import { regenerateRecommendationAction } from '@/app/hog/requests/[id]/actions';
import { facultyTypeLabel } from '@/lib/labels';

export function RecommendationList({
  requestId,
  result,
  onPick,
}: {
  requestId: string;
  result: RecommendationResult;
  onPick?: (facultyId: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  const regenerate = () => {
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      await regenerateRecommendationAction(fd);
    });
  };

  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">AI suggestions</span>
          {result.strategy === 'embedding' ? (
            <Badge variant="secondary">AI match</Badge>
          ) : (
            <Badge variant="outline" className="border-yellow-500 text-yellow-700">
              Rule-based match
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" disabled={pending} onClick={regenerate}>
          {pending ? 'Refreshing…' : 'Regenerate suggestions'}
        </Button>
      </div>
      {result.fallbackReason && (
        <p className="text-muted-foreground text-xs">
          AI matching isn&apos;t available, so suggestions use teaching history only.
        </p>
      )}
      <ol className="space-y-2">
        {result.candidates.map((c, i) => (
          <li
            key={c.facultyId}
            className="bg-background flex items-start justify-between gap-3 rounded-md p-2 text-sm"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-xs">#{i + 1}</span>
                <span className="font-medium">{c.name}</span>
                {c.facultyType && (
                  <Badge variant="outline" className="text-xs">
                    {facultyTypeLabel(c.facultyType)}
                  </Badge>
                )}
                {c.capped && (
                  <Badge variant="destructive" className="text-xs">
                    At course limit
                  </Badge>
                )}
              </div>
              <ul className="text-muted-foreground mt-1 list-disc pl-5 text-xs">
                {c.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="text-muted-foreground text-xs">
                Match {(c.score * 100).toFixed(0)}/100
              </div>
              {onPick && !c.capped && (
                <Button size="sm" variant="outline" onClick={() => onPick(c.facultyId)}>
                  Add
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
