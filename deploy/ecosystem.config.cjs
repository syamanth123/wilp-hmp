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
// Requires Node >= 20.6 (the --env-file flag). Ubuntu 24 LTS via NodeSource 20.x
// or 24.x both satisfy this; the repo targets Node 24.

const REPO = '/home/ubuntu/wilp-hmp';
const ENV_FILE = `${REPO}/apps/web/.env.production`;
const LOGS = '/home/ubuntu/logs';

module.exports = {
  apps: [
    {
      name: 'hmp-web',
      cwd: `${REPO}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      // FORK mode, single instance — deliberate for a 2-vCPU burstable box that
      // also runs hmp-worker AND LibreOffice (soffice spikes CPU+RAM during PDF
      // conversion). Cluster/`instances: 'max'` would spawn 2 web workers that
      // oversubscribe the 2 vCPUs and risk OOM on 4 GB. Scale to cluster only on
      // a larger instance. (Next's standalone server is stateless per request,
      // so clustering is safe correctness-wise — this is purely a capacity call.)
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '900M',
      // Crash-loop guard: if it can't stay up 30s, stop retrying after 10 tries.
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 4000,
      out_file: `${LOGS}/hmp-web.out.log`,
      error_file: `${LOGS}/hmp-web.err.log`,
      time: true, // timestamp each log line (ops readability)
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
      // vars PM2 already set below. Requires devDependencies (tsx) installed —
      // see deploy/README.md.
      script: 'node',
      args: `--env-file=${ENV_FILE} --import tsx apps/web/src/workers/start.ts`,
      // MUST stay at 1 instance: BullMQ handles concurrency INSIDE the process
      // (per-queue concurrency). A second worker process would double-consume
      // the queue.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 4000,
      out_file: `${LOGS}/hmp-worker.out.log`,
      error_file: `${LOGS}/hmp-worker.err.log`,
      time: true,
      env: {
        NODE_ENV: 'production',
        WORKERS_ENABLED: 'true', // web enqueues to Redis; this process consumes
      },
    },
  ],
};
