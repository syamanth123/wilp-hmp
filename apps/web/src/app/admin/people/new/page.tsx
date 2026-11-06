import { NewPersonView } from '../new-person-view';

export const dynamic = 'force-dynamic';

/** Admin → People → Add person (v1.4). */
export default function NewPersonPage() {
  return <NewPersonView base="/admin" />;
}
