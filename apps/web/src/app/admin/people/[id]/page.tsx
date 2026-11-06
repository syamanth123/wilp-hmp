import { PersonView } from '../person-view';

export const dynamic = 'force-dynamic';

/** Admin → People → a person (v1.4). */
export default function PersonPage({ params }: { params: { id: string } }) {
  return <PersonView base="/admin" id={params.id} />;
}
