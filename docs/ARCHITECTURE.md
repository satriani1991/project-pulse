# Architecture

```
apps/web          React 19 + TypeScript + Vite + Tailwind v4 + Recharts + Three.js (lazy) + TanStack Query
apps/server       Node 22.13+ · Fastify 5 · @fastify/websocket · Chokidar 4 · node:sqlite · Zod
packages/shared   Types, Zod schemas, constants, scoring (intensity, priority, sessions) used by both sides
data/             project-pulse.db, thumbnails/, backups/, manifests/
scripts/          start/stop/backup/install-startup (PowerShell), dev runner, static server for @static
```

## Deviations from the proposed stack (deliberate)

| PRD | Implemented | Why |
|---|---|---|
| SQLite via Drizzle ORM | `node:sqlite` with a thin typed query layer | No native module to compile on Windows; zero install friction |
| Sharp for image analysis | Pure-JS header parser (PNG, JPEG, GIF, WEBP, BMP, SVG) | Dimensions are all that is needed; avoids native binaries |
| simple-git | `git` CLI via `execFile` | Same behaviour, fewer dependencies |
| node-cron | Self-rescheduling timers with per-job status | Intervals are user-configurable at runtime |
| shadcn/ui | Small hand-written component set in the same style | No generator step |
| Electron / system tray | Background process + Task Scheduler script | Optional in PRD; keeps the app a plain local web app |

## Workspaces

`apps/server/src/workspace/context.ts` keeps a registry (`data/workspaces.json`) and an `AsyncLocalStorage` context.
Every request is run inside the workspace named by the `X-Pulse-Workspace` header (or `?ws=` for image/download/WebSocket
URLs); `db()` returns that workspace's SQLite database. Caches, mutexes, debounce timers, watchers, deployment
locks and managed processes are keyed by workspace, and WebSocket broadcasts only reach tabs of the same workspace.
Background jobs iterate over all workspaces with `runInWorkspace()`. The web client stores the active workspace per
tab (sessionStorage) with a per-browser default (localStorage), and the theme per workspace.

## Server modules (`apps/server/src`)

| Path | Responsibility |
|---|---|
| `database/db.ts` | Schema (all PRD §17 tables + git_commits, hosting version cache, hash pairs, audit log), WAL, transactions |
| `security/` | Path canonicalisation & traversal/symlink guard, ignore matcher, secret-file block list, redaction, audit |
| `services/filesystem/scanner.ts` | Incremental reconciliation: stat → hash only changed files → created/modified/deleted/renamed events (content-verified, so touches don't count). Recovers changes missed while stopped |
| `services/watcher/` | Chokidar per project; per-project debounce (default 3 s) and burst cap feed the scanner |
| `services/filesystem/discover.ts` | Bulk discovery by markers; infers name, category, technologies, commands, thumbnail, Firebase site/path (including projects living inside a shared hosting `public/` folder) |
| `services/firebase/` | Auth (service account JWT, Firebase CLI login, gcloud), releases, paginated version files (cached forever) |
| `services/deployment/state.ts` | Status engine: manifest → verified pairs → baseline → timestamp; per-project release history with subtree digests |
| `services/deployment/deployer.ts` | Preflight + one-time confirmation token → build → deploy → wait for release → verify |
| `services/git/` | Snapshot (branch, dirty files, ahead/behind, remote), commit ingestion, first-run history import |
| `services/analytics/` | Daily aggregates, sessions (15-min gap), heatmap quantile levels, intensity, monthly, frequency, timeline queries |
| `services/assets/` | Asset index, duplicates, large files, broken references, possibly-unused, formats, dimension consistency |
| `services/dependencies/` | package.json / file: links / relative imports / copied-file hashes / manual edges; transitive dependents |
| `services/recommendations/` | Rule engine (PRD §13) |
| `services/process-manager/` | Spawn configured commands, log ring buffers streamed over WebSocket, tree-kill, port checks, desktop launchers |
| `jobs/scheduler.ts` | Startup reconciliation then Firebase (5 min), Git (60 s), health (15 min), reconcile (60 min), analytics (15 min), retention + daily DB backup |

History seeding: on first registration, Git projects import the last year of commits (`git log --name-status`);
non-Git projects record each file's last-modified time once. Both are flagged (`seed:git`, `seed:mtime`) and hidden
from the timeline unless "Include imported history" is enabled. Estimated development time excludes mtime seeds.

## WebSocket events

`project.updated project.removed file.created file.modified file.deleted file.renamed git.updated deployment.started
deployment.completed deployment.failed analytics.updated notification.created process.started process.stopped process.output`

## Testing

`npm test` runs Vitest unit tests (scoring, manifest comparison, shared-site subsetting, ignore rules, secrets,
image headers) and integration tests (discovery, registration, duplicate prevention, add/modify/rename/delete
detection, touch-without-change, traversal protection). `apps/server/test/mock-firebase.mjs` is a mock of the
Hosting API used for end-to-end testing of shared-site deployments.
