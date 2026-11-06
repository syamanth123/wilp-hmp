import { NewPersonView } from '@/app/admin/people/new-person-view';

export const dynamic = 'force-dynamic';

/** Instruction Cell → People → Add person (v1.4.0). */
export default function IcNewPersonPage() {
  return <NewPersonView base="/ic" />;
}
