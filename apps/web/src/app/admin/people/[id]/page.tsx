import { PersonView } from '../person-view';

export const dynamic = 'force-dynamic';

/** Admin → People → a person (v1.4). */
export default function PersonPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { leaving?: string };
}) {
  return <PersonView base="/admin" id={params.id} leaving={searchParams.leaving === '1'} />;
}
