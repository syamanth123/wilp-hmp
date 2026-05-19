import { redirect } from 'next/navigation';
import { getSessionUser } from '@hmp/auth';
import { defaultRouteForUser } from '@/lib/routing';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(defaultRouteForUser(user));
}
