import { PeopleView } from '@/app/admin/people/people-view';

export const dynamic = 'force-dynamic';

/** Instruction Cell → People (v1.4.0): Admin's People page, without changes to Admin accounts. */
export default function IcPeoplePage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  return <PeopleView base="/ic" searchParams={searchParams} />;
}
