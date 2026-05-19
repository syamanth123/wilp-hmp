import { prisma } from '@hmp/db';
import { Badge } from '@hmp/ui';

export async function FacultyAssignmentsList({ requestId }: { requestId: string }) {
  const assignments = await prisma.facultyAssignment.findMany({
    where: { requestId },
    orderBy: { assignedAt: 'asc' },
    include: { faculty: { select: { name: true, email: true, facultyType: true } } },
  });

  if (assignments.length === 0) {
    return <p className="text-sm text-muted-foreground">No faculty allocated yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {assignments.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 border-b pb-2">
          <div>
            <div className="font-medium">{a.faculty.name}</div>
            <div className="text-xs text-muted-foreground">{a.faculty.email}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{a.facultyType.replace(/_/g, ' ')}</Badge>
            {a.acceptedAt ? (
              <Badge variant="success">Accepted</Badge>
            ) : (
              <Badge variant="outline">Pending</Badge>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
