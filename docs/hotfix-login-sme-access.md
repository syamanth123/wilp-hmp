# Hotfix runbook — login page and SME access

Branch `hotfix/login-sme-access` = `main` + two security fixes:

| Commit                                                                          | Fix                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix(security): login page shows demo accounts only with SHOW_DEMO_LOGINS=true` | The login page no longer lists the demo accounts or their password and no longer pre-fills a login. The list appears only when `SHOW_DEMO_LOGINS=true` (never on a server). |
| `fix(security): an SME can open only handouts assigned to them`                 | `/sme/review/<id>` shows "You don't have access to this page" to any SME who is not the assigned SME. Admins are unchanged.                                                 |

Everything below is copy-paste for the EC2 host, run as `ubuntu` in an SSH session (PuTTY, as in
`deploy/ONE_HOUR_DEPLOY.md` §1). It follows `docs/deployment-runbook.md` and `deploy/deploy.sh`.
Nothing here changes the database.

## Does this need `prisma migrate deploy`?

**No.** The two commits change no file under `packages/db/prisma` (no schema change, no
migration). `main`'s newest migration dates from June 2026, before the pilot went live, so the
server's database already has every migration on `main`. Step 4 confirms this on the server
before anything is changed. If you use `deploy/deploy.sh` (path A) it still runs
`prisma migrate deploy`; with nothing pending that is a harmless no-op.

## 1. Before you start (5 min)

- Pick a quiet time; the web app reloads for a few seconds.
- Have the AWS console open (for the database snapshot) and an SME account you can sign in with
  (for the check in step 7).

## 2. Back up

**a. Database snapshot (AWS console).** RDS → Databases → the HMP database → Actions →
_Take snapshot_ → name it `hmp-before-hotfix-YYYYMMDD` → wait until its status is _Available_.
This fix doesn't touch the database; the snapshot is only a safety net.

**b. Code, settings and the current build (on the server).**

```bash
cd /home/ubuntu/wilp-hmp
TS=$(date +%Y%m%d-%H%M)
B=/home/ubuntu/backups/hotfix-$TS
mkdir -p "$B"
git rev-parse HEAD | tee "$B/OLD_SHA"
cp apps/web/.env.production "$B/"
cp -a apps/web/.next "$B/next"
echo "Backup folder: $B"
```

Write down the backup folder path; the rollback (step 9) uses it.

## 3. Check the settings that must NOT be on

```bash
cd /home/ubuntu/wilp-hmp
grep -nE '^\s*(SHOW_DEMO_LOGINS|AI_FEATURES_ENABLED)\s*=' apps/web/.env.production \
  || echo "OK: neither SHOW_DEMO_LOGINS nor AI_FEATURES_ENABLED is set in .env.production"
pm2 env "$(pm2 id hmp-web | tr -dc '0-9')" | grep -E 'SHOW_DEMO_LOGINS|AI_FEATURES_ENABLED' \
  || echo "OK: neither is set in the running hmp-web process"
```

Both lines should print `OK: …`. If either prints a setting, remove it before deploying:

```bash
sed -i -E '/^\s*(SHOW_DEMO_LOGINS|AI_FEATURES_ENABLED)\s*=/d' apps/web/.env.production
```

(`AI_FEATURES_ENABLED` has no effect on this hotfix; it is checked now because a later release
uses it, and it must stay off until AI is launched.)

## 4. See what will change, and confirm no migration

```bash
cd /home/ubuntu/wilp-hmp
git status --short                      # must print nothing (no local edits to lose)
git fetch origin
git log --oneline HEAD..origin/hotfix/login-sme-access
git diff --name-only HEAD origin/hotfix/login-sme-access -- packages/db/prisma
pnpm --filter @hmp/db exec prisma migrate status
```

- `git log` lists the commits that will go live: the two security fixes, plus any `main` commits
  the server doesn't have yet (for example the login rate-limit fix).
- The `git diff` line must print **nothing** — no database files change.
- `migrate status` should end with _Database schema is up to date!_

If `git status` shows edits, or the `git diff` line prints a migration, stop and ask before going on.

## 5. Deploy — choose one path

**Path A (recommended): merge first, then the normal deploy.** Approve and merge the
`hotfix/login-sme-access` pull request on GitHub, then on the server:

```bash
cd /home/ubuntu/wilp-hmp
./deploy/deploy.sh
```

It ends with `DEPLOY SUCCESSFUL` or prints its own rollback commands.

**Path B: deploy the branch before merging** (if the fix must go live before the PR is reviewed):

```bash
cd /home/ubuntu/wilp-hmp
git reset --hard origin/hotfix/login-sme-access
pnpm install --frozen-lockfile
pnpm --filter @hmp/db exec prisma generate
pnpm --filter @hmp/web build
export GIT_SHA=$(git rev-parse --short HEAD)
pm2 reload deploy/ecosystem.config.cjs --update-env
sleep 5 && pm2 list                      # hmp-web and hmp-worker must both be "online"
curl -s http://localhost:3000/api/health; echo
```

On path B, **merge the PR before the next `deploy.sh` run** — `deploy.sh` deploys `main`, and
an unmerged hotfix would be undone.

## 6. Check the login page

On the server:

```bash
curl -s http://localhost:3000/login | grep -cE 'password is|@hmp\.local'      # expect 0
curl -s http://localhost:3000/login | grep -oE 'value="(admin@[^"]*|password)"' \
  || echo "OK: nothing pre-filled"
```

From your own computer: open the portal's login page in a **private / incognito** window. You
should see only empty Email and Password boxes and no list of accounts.

## 7. Check that an SME can't open someone else's handout

Find a request that is **not** assigned to a given SME (read-only):

```bash
cd /home/ubuntu/wilp-hmp/packages/db
cat > sme-check.tmp.mjs <<'EOF'
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const smes = await prisma.user.findMany({
  where: { active: true, roles: { some: { role: { name: 'SME' } } } },
  select: { id: true, email: true },
});
for (const sme of smes) {
  const other = await prisma.handoutRequest.findFirst({
    where: {
      OR: [
        { smeAssignment: { is: null } },
        { smeAssignment: { is: { smeUserId: { not: sme.id } } } },
      ],
    },
    select: { id: true, refNo: true },
  });
  console.log(`${sme.email}: try /sme/review/${other?.id ?? '(no other request exists)'}  (${other?.refNo ?? '-'})`);
}
await prisma.$disconnect();
EOF
node --env-file=../../apps/web/.env.production sme-check.tmp.mjs
rm sme-check.tmp.mjs
```

Sign in as one of the listed SMEs (private window), then open
`<portal address>/sme/review/<id>` from the line printed for that SME. Expected: **"You don't
have access to this page"**, and no handout content or reference number. Signed in as the
administrator, the same address shows the handout.

## 8. Find accounts still using the default password (read-only)

Hiding the list does not change any password. Before this release, the admin "Create user" form
also pre-filled the password `password`, so real accounts created through it may still have it.
This lists every account whose password is still `password`. It only reads; it changes nothing.

```bash
cd /home/ubuntu/wilp-hmp/packages/db
cat > default-passwords.tmp.mjs <<'EOF'
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  select: { email: true, active: true, passwordHash: true },
  orderBy: { email: 'asc' },
});
let hits = 0;
for (const u of users) {
  if (u.passwordHash && (await bcrypt.compare('password', u.passwordHash))) {
    hits++;
    console.log(`DEFAULT PASSWORD  ${u.active ? 'active  ' : 'inactive'}  ${u.email}`);
  }
}
console.log(`${users.length} accounts checked; ${hits} still use the default password.`);
await prisma.$disconnect();
EOF
node --env-file=../../apps/web/.env.production default-passwords.tmp.mjs
rm default-passwords.tmp.mjs
```

For each account listed: if it is a demo account (`@hmp.local`), switch it off in **Admin →
Users → Deactivate**; for a real person, give them a new password. (The portal has no
password-reset screen yet; ask for a one-off reset script if needed.) Run the check again until
it reports 0.

## 9. Rollback

No database change was made, so rollback is code only.

```bash
cd /home/ubuntu/wilp-hmp
B=/home/ubuntu/backups/hotfix-<TS>          # the folder from step 2b
git reset --hard "$(cat "$B/OLD_SHA")"
pnpm install --frozen-lockfile
pnpm --filter @hmp/db exec prisma generate
rm -rf apps/web/.next && cp -a "$B/next" apps/web/.next     # the previous build (fast)
export GIT_SHA=$(git rev-parse --short HEAD)
pm2 reload deploy/ecosystem.config.cjs --update-env
sleep 5 && pm2 list
```

If the restored build won't start, rebuild instead of copying it back:
`pnpm --filter @hmp/web build` and reload again. The RDS snapshot from step 2a is only needed if
something unrelated damaged data.

Rolling back brings back the account list on the login page, so do it only if the new release
won't run.
