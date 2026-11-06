import { PeopleView } from './people-view';

export const dynamic = 'force-dynamic';

/** Admin → People (v1.4). The same page is the Instruction Cell's under /ic/people. */
export default function PeoplePage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  return <PeopleView base="/admin" searchParams={searchParams} />;
}
