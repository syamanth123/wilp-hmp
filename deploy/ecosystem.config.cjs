// PM2 process manifest for HMP on a single EC2 host (t3a.medium, Ubuntu).
//
// Two processes:
//   hmp-web    — Next.js production server on 127.0.0.1:3000 (behind Nginx)
//   hmp-worker — BullMQ worker (notifications + AI); the ONLY job processor
//
// ── SECRETS ARE DELIBERATELY ABSENT FROM THIS FILE ──────────────────────────
// S3 authentication uses the EC2 INSTANCE ROLE via the AWS SDK default provider
// chain (see packages/integrations/src/storage.ts). Do NOT add S3_ACCESS_KEY or
// S3_SECRET_KEY here — leaving them out is what forces the instance-role path
// and prevents anyone re-introducing static keys. Every other secret lives in
// the .env file each process loads (never in this committed manifest):
//   • hmp-web    — Next.js auto-loads apps/web/.env.production
//   • hmp-worker — Node's --env-file loads the SAME file (tsx run; no dotenv dep)
// The only vars set here are non-secret operational flags (NODE_ENV,
// WORKERS_ENABLED), which --env-file does not override.
//
// Adjust REPO to the deploy path.

const REPO = '/opt/hmp';
const ENV_FILE = `${REPO}/apps/web/.env.production`;

module.exports = {
  apps: [
    {
      name: 'hmp-web',
      cwd: `${REPO}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1, // single instance on t3a.medium (shares 4GB with worker + LibreOffice)
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'production',
        // DATABASE_URL, REDIS_URL, NEXTAUTH_*, APP_BASE_URL, SMTP_*, S3_REGION,
        // bucket names, etc. come from apps/web/.env.production (Next auto-loads).
      },
    },
    {
      name: 'hmp-worker',
      cwd: REPO,
      // The worker is TypeScript run via tsx. Node's --env-file loads the same
      // .env the web app uses (dotenv is not a dependency); it does NOT override
      // vars PM2 already set below. Requires devDependencies (tsx) to be
      // installed — see deploy/README.md.
      script: 'node',
      args: `--env-file=${ENV_FILE} --import tsx apps/web/src/workers/start.ts`,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        WORKERS_ENABLED: 'true', // web enqueues to Redis; this process consumes
      },
    },
  ],
};
