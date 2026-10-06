# ci-local — run the GitHub Actions pipeline on your laptop

GitHub Actions is unavailable for this account (billing lock), and nothing may
merge into `main` without a full green run for the exact commit. This folder
reproduces both jobs of [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
in Docker with the same recipe CI uses:

| CI                                                                                | here                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ubuntu-latest` runner, Node 20, pnpm 9.12.0                                      | `node:20-bookworm` container, `npm i -g pnpm@9.12.0`                                                                                                                       |
| `actions/checkout`                                                                | **fresh `git clone` of this repo inside the container** at the requested ref — Windows `node_modules`, `.env` files, build output and uncommitted edits never reach it     |
| `services:` postgres:16-alpine / redis:7-alpine / mailhog; MinIO via `docker run` | the same four images as compose services, sharing the runner's network namespace, so each one listens on the runner's `localhost` like a published port on a GitHub runner |
| the jobs' `env:` blocks                                                           | the same values, verbatim (`localhost` everywhere)                                                                                                                         |
| `setup-node` pnpm cache                                                           | a named volume for the pnpm store (plus one for Chromium)                                                                                                                  |
| one job = one fresh set of services                                               | `docker compose down` between jobs (containers recreated; Postgres and MinIO data are tmpfs)                                                                               |
| artifact upload on e2e failure                                                    | `playwright-report/` + `test-results/` copied into the output folder                                                                                                       |

The step list, order and commands live in `run-job.sh` and mirror `ci.yml` one
to one; keep them in step when `ci.yml` changes.

## Usage

```powershell
# both jobs (e2e only runs if ci passed, like `needs: ci`)
.\scripts\ci-local\run.ps1 -Ref main
.\scripts\ci-local\run.ps1 -Ref feature/course-dibba
# one job
.\scripts\ci-local\run.ps1 -Ref 04e1799 -Job e2e
```

Output: a per-step table with exit codes, and `scripts\ci-local\out\<sha7>-<job>\`
holding `report.tsv`, `meta.txt`, `steps\NN-<name>.log`, and on an e2e failure
`playwright-report\` / `test-results\` / `worker.log`. The `out\` folder is
gitignored.

**Only committed objects are tested.** The runner clones `.git`; an
uncommitted or untracked change on your machine is not part of any ref. The
script warns when the working tree is dirty — commit (even a scratch commit)
and run that sha.

Requirements: Docker Desktop (WSL 2 backend) running, and internet on every
run — the runner container is ephemeral, so `npm i -g pnpm` and
`playwright install --with-deps` (apt) always hit the network; images, the
pnpm store and the Chromium build persist in Docker volumes, so a second run
is much faster. Pulls from the Docker Desktop VM sometimes hit a
"TLS handshake timeout" against Docker Hub; the runner retries each image six
times. A full `all` run is roughly 10–20 minutes.

## Notes

- Ports are not published to Windows, so the local Postgres on 5432 and the
  `tools\` services are untouched.
- `CI=true` is set in the runner, as GitHub does: Playwright serves the
  production build (`next start`) with 2 retries, exactly as in CI.
- ci.yml's `timeout-minutes: 15` on the e2e job is not enforced here; read the
  per-step seconds in the table if timing matters.
- Memory: `next build` plus Chromium want ~3 GB inside the WSL VM (default
  cap: half of RAM). If a step dies with exit 137 (OOM), raise `memory=` in
  `%USERPROFILE%\.wslconfig` and `wsl --shutdown`.
