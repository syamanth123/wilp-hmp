import type { FacultyType} from '@hmp/db';
import { prisma, RoleName, ACTIVE_USER_FILTER } from '@hmp/db';

export interface FacultyOption {
  id: string;
  name: string;
  email: string;
  facultyType: FacultyType | null;
  loadInSemester: number;
}

/**
 * Count of active FacultyAssignments held by `facultyId` in the same
 * Semester (joined via the request's CourseOffering).
 */
export async function getFacultyLoadInSemester(
  facultyId: string,
  semesterId: string,
): Promise<number> {
  return prisma.facultyAssignment.count({
    where: {
      facultyId,
      active: true,
      request: { offering: { semesterId } },
    },
  });
}

/**
 * Lists all active faculty for an allocation drop-down, including each
 * faculty's current load in the target semester so the UI can render
 * capped users disabled.
 */
export async function listFacultyForAllocation(semesterId: string): Promise<FacultyOption[]> {
  const faculties = await prisma.user.findMany({
    where: {
      ...ACTIVE_USER_FILTER,
      roles: { some: { role: { name: RoleName.FACULTY } } },
    },
    select: { id: true, name: true, email: true, facultyType: true },
    orderBy: { name: 'asc' },
  });

  const loads = await prisma.facultyAssignment.groupBy({
    by: ['facultyId'],
    where: {
      active: true,
      facultyId: { in: faculties.map((f) => f.id) },
      request: { offering: { semesterId } },
    },
    _count: { _all: true },
  });
  const loadMap = new Map(loads.map((l) => [l.facultyId, l._count._all]));

  return faculties.map((f) => ({
    id: f.id,
    name: f.name,
    email: f.email,
    facultyType: f.facultyType,
    loadInSemester: loadMap.get(f.id) ?? 0,
  }));
}
