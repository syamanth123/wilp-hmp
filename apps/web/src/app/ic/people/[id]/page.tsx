import { PersonView } from '@/app/admin/people/person-view';

export const dynamic = 'force-dynamic';

/** Instruction Cell → People → a person (v1.4.0). */
export default function IcPersonPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { leaving?: string; undone?: string };
}) {
  return (
    <PersonView
      base="/ic"
      id={params.id}
      leaving={searchParams.leaving === '1'}
      undone={searchParams.undone === '1'}
    />
  );
}
