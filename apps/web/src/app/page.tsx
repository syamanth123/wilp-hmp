import { redirect } from 'next/navigation';
import { getSessionUser } from '@hmp/auth';
import { defaultRouteForUser } from '@/lib/routing';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/api/session-ended'); // signed in, but switched off since (v1.4.0)
  redirect(defaultRouteForUser(user));
}
