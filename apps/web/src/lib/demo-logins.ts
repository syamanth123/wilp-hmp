/**
 * SHOW_DEMO_LOGINS (default OFF): list the demo accounts and their shared
 * password on the login page. For a local demo only.
 *
 * Deliberately NOT tied to NODE_ENV: the demo and ci-local builds also run in
 * production mode, so "not production" would either hide the list from the
 * demo or leave it on a real server.
 */
export function demoLoginsVisible(): boolean {
  return (process.env.SHOW_DEMO_LOGINS ?? '').trim().toLowerCase() === 'true';
}
