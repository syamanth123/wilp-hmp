import { UploadPeopleView } from './upload-view';

export const dynamic = 'force-dynamic';

/** Admin → People → Upload (v1.4.0). */
export default function UploadPeoplePage() {
  return <UploadPeopleView base="/admin" />;
}
