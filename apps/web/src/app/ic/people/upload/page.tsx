import { UploadPeopleView } from '@/app/admin/people/upload/upload-view';

export const dynamic = 'force-dynamic';

/** Instruction Cell → People → Upload (v1.4.0). */
export default function IcUploadPeoplePage() {
  return <UploadPeopleView base="/ic" />;
}
