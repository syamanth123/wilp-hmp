import type { DibbaEntry } from '@hmp/db';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';
import { slotLabel } from '../format';

/**
 * One collapsible table per programme (plan §1.5). ~41 programmes × ~26 rows
 * on the real file; <details> keeps the initial DOM small, so no pagination.
 * The "not in catalogue" pill comes from the LIVE match (D10), not the stored
 * courseId. rawCell sits in the code cell's tooltip ("why did it parse like this").
 */
type Entry = Pick<
  DibbaEntry,
  | 'id'
  | 'programmeCode'
  | 'programmeTitle'
  | 'admitBatch'
  | 'isNewAdmission'
  | 'isBacklogRow'
  | 'studentCount'
  | 'slotNo'
  | 'slotDay'
  | 'slotSession'
  | 'courseCode'
  | 'courseTitle'
  | 'courseType'
  | 'classTimeHint'
  | 'rawCell'
>;

const TYPE_LABEL: Record<Entry['courseType'], string> = {
  CORE: 'Core',
  ELECTIVE: 'Elective',
  PROJECT: 'Project',
  BACKLOG: 'Backlog',
  NOT_OFFERED: 'Not offered',
  UNSPECIFIED: 'Unspecified',
};

export function ProgrammeTables({
  entries,
  linked,
}: {
  entries: Entry[];
  linked: ReadonlySet<string>;
}) {
  const groups = new Map<string, { title: string; rows: Entry[] }>();
  for (const e of entries) {
    const g = groups.get(e.programmeCode) ?? { title: e.programmeTitle, rows: [] };
    g.rows.push(e);
    groups.set(e.programmeCode, g);
  }
  return (
    <div className="space-y-2" data-testid="dibba-programme-tables">
      {[...groups.entries()].map(([code, g]) => {
        const batches = new Set(g.rows.map((r) => r.admitBatch ?? '—')).size;
        return (
          <details key={code} className="rounded-md border" data-testid={`dibba-programme-${code}`}>
            <summary className="cursor-pointer px-3 py-2 text-sm">
              <span className="font-mono">{code}</span> {g.title}{' '}
              <span className="text-muted-foreground text-xs">
                — {g.rows.length} rows · {batches} batch{batches === 1 ? '' : 'es'}
              </span>
            </summary>
            <div className="px-3 pb-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Students</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Class time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.admitBatch ?? <span className="text-muted-foreground">—</span>}
                        {r.isNewAdmission && (
                          <span className="text-muted-foreground ml-1">new</span>
                        )}
                        {r.isBacklogRow && (
                          <span className="text-muted-foreground ml-1">backlog</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.studentCount ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {slotLabel(r.slotNo, r.slotDay, r.slotSession)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span className="font-mono" title={r.rawCell}>
                          {r.courseCode}
                        </span>
                        {!linked.has(r.courseCode) && (
                          <Badge variant="outline" className="ml-1 font-normal">
                            not in catalogue
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.courseTitle}</TableCell>
                      <TableCell className="text-xs">{TYPE_LABEL[r.courseType]}</TableCell>
                      <TableCell className="text-xs">
                        {r.classTimeHint ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
