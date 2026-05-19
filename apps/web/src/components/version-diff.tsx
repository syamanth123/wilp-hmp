import { diffLines } from 'diff';
import { prisma } from '@hmp/db';
import { extractTiptapText } from '@/lib/handout-versioning';

interface Props {
  handoutId: string;
  fromVersion: number;
  toVersion: number;
}

export async function VersionDiff({ handoutId, fromVersion, toVersion }: Props) {
  if (fromVersion === toVersion) {
    return <p className="text-sm text-muted-foreground">Pick two different versions to compare.</p>;
  }
  const [from, to] = await Promise.all([
    prisma.handoutVersion.findFirst({ where: { handoutId, versionNo: fromVersion } }),
    prisma.handoutVersion.findFirst({ where: { handoutId, versionNo: toVersion } }),
  ]);
  if (!from || !to) {
    return <p className="text-sm text-destructive">One or both versions not found.</p>;
  }
  const parts = diffLines(extractTiptapText(from.contentJson), extractTiptapText(to.contentJson));
  return (
    <div className="space-y-1 rounded-md border bg-background p-3 font-mono text-xs">
      <div className="mb-2 text-muted-foreground">
        Comparing v{fromVersion} → v{toVersion}
      </div>
      {parts.map((p, i) => (
        <pre
          key={i}
          className={
            p.added
              ? 'whitespace-pre-wrap rounded bg-emerald-50 px-2 py-0.5 text-emerald-900'
              : p.removed
                ? 'whitespace-pre-wrap rounded bg-rose-50 px-2 py-0.5 text-rose-900 line-through'
                : 'whitespace-pre-wrap text-muted-foreground'
          }
        >
          {(p.added ? '+ ' : p.removed ? '- ' : '  ') + p.value}
        </pre>
      ))}
    </div>
  );
}
