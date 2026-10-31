import { listVersions } from '@/lib/handout-versioning';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';
import { formatDateTime } from '@/lib/format-date';

export async function VersionList({ handoutId }: { handoutId: string }) {
  const versions = await listVersions(handoutId);
  if (versions.length === 0) {
    return <p className="text-muted-foreground text-sm">No versions yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">v#</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Saved</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((v) => (
          <TableRow key={v.versionNo}>
            <TableCell className="font-mono text-xs">v{v.versionNo}</TableCell>
            <TableCell className="text-sm">{v.authorName}</TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {formatDateTime(v.createdAt)}
            </TableCell>
            <TableCell className="text-xs">{v.notes ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
