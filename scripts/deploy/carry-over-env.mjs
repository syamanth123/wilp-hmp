#!/usr/bin/env node
//
// Builds the v1.0.0 settings file from the old pilot's one, so nothing is retyped and no value is
// ever shown on screen:
//
//   node scripts/deploy/carry-over-env.mjs <old .env.production> <new .env.production>
//
// Keeps every old value (database address, NEXTAUTH_SECRET, S3 keys, SMTP, CRON_SECRET, corpus
// folder, …) except the ones v1.0.0 must set differently, and prints only setting NAMES with what
// happened to each. Writes the new file with permissions 600 and refuses to overwrite one.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const DOMAIN = 'https://hmp.wilp-connect.net';
const BUCKET = 'handout-09-07-2026';

// Always this value in v1.0.0, whatever the old file said.
const SET = {
  NEXTAUTH_URL: DOMAIN,
  APP_BASE_URL: DOMAIN,
  AUTH_TRUST_HOST: 'true',
  AI_FEATURES_ENABLED: 'false',
  PASSWORD_LOGIN_ENABLED: 'true',
  NODE_ENV: 'production',
  S3_REGION: 'ap-south-1',
  HANDOUT_ATTACHMENTS_BUCKET: BUCKET,
  LMS_EXPORTS_BUCKET: BUCKET,
};
// Only when the old file doesn't have them.
const DEFAULTS = {
  REDIS_URL: () => 'redis://127.0.0.1:6379',
  SOFFICE_BIN: () => 'soffice',
  CRON_SECRET: () => randomBytes(24).toString('hex'),
};
// Never carried over.
const DROP = {
  SHOW_DEMO_LOGINS: 'lists demo accounts on the login page',
  WORKERS_ENABLED: 'no worker process in v1.0.0 (emails are sent during the request)',
  AUTH_URL: 'would override NEXTAUTH_URL (the old one pointed at the IP)',
  S3_ENDPOINT: 'MinIO / local only — real AWS S3 needs no endpoint',
  S3_FORCE_PATH_STYLE: 'MinIO / local only',
  S3_BUCKET: 'not read by the code (HANDOUT_ATTACHMENTS_BUCKET / LMS_EXPORTS_BUCKET are)',
};
const SMTP = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

/** Minimal dotenv parser: KEY=value, optional `export `, '…' / "…" quotes, # comments. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const q = value[0];
    if ((q === "'" || q === '"') && value.indexOf(q, 1) > 0) {
      value = value.slice(1, value.indexOf(q, 1));
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Pure: old settings → { env, report, errors }. Report lines carry names only, never values. */
export function carryOver(old, makeDefault = (k) => DEFAULTS[k]()) {
  const env = {};
  const report = [];
  const errors = [];

  for (const [k, v] of Object.entries(old)) {
    if (k in DROP) report.push(`removed  ${k} — ${DROP[k]}`);
    else if (k in SET) continue;
    else if (SMTP.includes(k)) continue;
    else env[k] = v;
  }
  for (const k of Object.keys(old)) {
    if (!(k in DROP) && !(k in SET) && !SMTP.includes(k)) report.push(`kept     ${k}`);
  }

  for (const [k, v] of Object.entries(SET)) {
    env[k] = v;
    if (!(k in old)) report.push(`added    ${k}`);
    else report.push(old[k] === v ? `kept     ${k} (already right)` : `changed  ${k}`);
  }
  for (const k of Object.keys(DEFAULTS)) {
    if (!(env[k] ?? '').trim()) {
      env[k] = makeDefault(k);
      report.push(`added    ${k} (new value)`);
    }
  }

  // SMTP: only a real account is carried; a blank or "<…>" host would make the app try to connect.
  const host = (old.SMTP_HOST ?? '').trim();
  if (host && !host.includes('<')) {
    for (const k of SMTP) if (k in old) env[k] = old[k];
    report.push('kept     SMTP_* (an SMTP account is set)');
  } else if (SMTP.some((k) => k in old)) {
    report.push('removed  SMTP_* — no real SMTP host (emails are skipped, the app works)');
  }

  if (!(env.DATABASE_URL ?? '').trim()) {
    errors.push('DATABASE_URL is missing in the old file');
  } else if (!/[?&]sslmode=/.test(env.DATABASE_URL)) {
    env.DATABASE_URL += (env.DATABASE_URL.includes('?') ? '&' : '?') + 'sslmode=require';
    report.push('changed  DATABASE_URL (added sslmode=require; address and password unchanged)');
  }
  if (!(env.NEXTAUTH_SECRET ?? env.AUTH_SECRET ?? '').trim()) {
    errors.push('NEXTAUTH_SECRET (or AUTH_SECRET) is missing in the old file');
  }
  for (const k of ['S3_ACCESS_KEY', 'S3_SECRET_KEY']) {
    report.push(
      (env[k] ?? '').trim()
        ? `REPLACE  ${k} — the pilot's may be MinIO values; put IT's key for user "handout" in (§2)`
        : `MISSING  ${k} — add IT's key for user "handout" (§2)`,
    );
  }
  for (const [k, v] of Object.entries(env)) {
    if (/['\n\r]/.test(v)) errors.push(`${k} contains a quote or line break — copy it by hand`);
  }
  return { env, report, errors };
}

export function render(env) {
  const lines = [
    '# HMP v1.0.0 settings — built by scripts/deploy/carry-over-env.mjs from the old pilot file.',
  ];
  for (const k of Object.keys(env).sort()) lines.push(`${k}='${env[k]}'`);
  return lines.join('\n') + '\n';
}

function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error(
      'usage: node scripts/deploy/carry-over-env.mjs <old .env.production> <new .env.production>',
    );
    process.exit(2);
  }
  if (!existsSync(from)) {
    console.error(`old settings file not found: ${from}`);
    process.exit(1);
  }
  if (existsSync(to)) {
    console.error(`${to} already exists — not overwriting it (delete it first to rebuild)`);
    process.exit(1);
  }
  const { env, report, errors } = carryOver(parseEnv(readFileSync(from, 'utf8')));
  for (const line of report) console.log(`  ${line}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ERROR    ${e}`);
    console.error('Nothing written.');
    process.exit(1);
  }
  writeFileSync(to, render(env), { mode: 0o600 });
  console.log(
    `Wrote ${to} (${Object.keys(env).length} settings, permissions 600). Values were not shown.`,
  );
}

if (process.argv[1]?.endsWith('carry-over-env.mjs')) main();
