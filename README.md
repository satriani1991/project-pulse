# PROJECT PULSE

**Track your development. Monitor your deployments. Never leave a project behind.**

A local-first dashboard for a developer with many web games, libraries and apps. It watches your project folders,
records every meaningful change, and compares each project's deployable files against what Firebase Hosting is
actually serving — **per project path**, so deploying one game on a shared site never makes the others look up to date.

## Quick start (Windows 11)

1. Install **Node.js 22.13 or newer** (LTS 24 recommended) and Git.
2. Double-click **`start.bat`**. The first run installs dependencies (`npm install`) and builds; afterwards it opens
   <http://127.0.0.1:7700>.
3. Click **Discover** and select `C:\ProjectX` to register all games and libraries at once, or **Add Project** for a single folder
   (the **Browse** button opens a native Windows folder picker).
4. For Firebase-hosted projects, set the **hosting site**, **remote path** (e.g. `/games/tka/`) and **deploy directory**
   (`.` for vanilla canvas games, `dist` for Vite builds). Discovery fills these in automatically when it finds `firebase.json`.

Other ways to run:

| Command | Purpose |
|---|---|
| `npm start` | Run the built server in the foreground |
| `scripts\start.ps1` / `scripts\stop.ps1` | Start hidden in the background / stop it |
| `scripts\install-startup.ps1` | Start automatically at Windows logon (Task Scheduler) |
| `scripts\backup.ps1` | Back up the database and thumbnails |
| `npm run dev` | Development mode: API with hot reload + Vite on <http://localhost:5173> |
| `npm run build` / `npm test` / `npm run typecheck` | Build, unit + integration tests (Vitest), type checks |

## Workspaces (e.g. Private and Office)

Workspaces are fully separate sets of projects. Each has its own projects, settings, activity history, tasks, notes,
notifications, backups and theme. **Each browser (or tab) picks its own workspace**, so you can keep your private
projects open in one browser and your office projects in another at the same time.

- Switch or create a workspace from the selector at the top of the sidebar; manage them in **Settings → Workspaces**.
- Open a specific workspace directly with `http://127.0.0.1:7700/?ws=<id>` (e.g. bookmark `?ws=office` in your work browser).
  The choice is remembered for that browser.
- The **theme changer** (☀ / ☾ / 🖥 in the top bar, or Settings) switches between Light, Dark and System (follows Windows).
  The choice is saved per workspace — e.g. Private in dark mode, Office in light mode. The coloured line at the top
  of the page shows which workspace you are in.
- Data lives in `data/` for the default workspace and `data/workspaces/<id>/` for the others. Removing a workspace
  never touches your project folders; you can choose whether its dashboard data is deleted too.
- Background monitoring runs for all workspaces. Interval settings are taken from the default workspace.

## Firebase credentials

Deployment status uses the Firebase Hosting REST API (read-only: release list and version file manifests). Any one of:

- **Firebase CLI** – run `firebase login` once; Pulse reuses that login.
- **Google Cloud CLI** – `gcloud auth login`.
- **Service account** – a key with *Firebase Hosting Viewer*; set its path in **Settings → Firebase Hosting**.

Without credentials Pulse still works: status falls back to a confirmed baseline, then to a timestamp hint
(clearly labelled *Possibly outdated*).

## How deployment status is decided

1. **Manifest comparison (preferred).** Firebase stores each file as SHA-256 of its gzip content. Pulse gzips your local
   deployable files the same way (cached) and compares them path-by-path against the latest release, restricted to the
   project's remote path (and excluding deeper paths owned by other registered projects).
2. **Verified pairs.** When hashes can't be reproduced, Pulse learns equivalences from deployments it ran itself,
   from a baseline you explicitly confirm, or from **Verify via HTTP** (downloads production files and hashes them).
3. **Timestamp fallback** only when no manifest or baseline exists.

Each release is checked against the previous one per project subtree, so a site-wide release that didn't touch
`/games/tka/` is shown as *Site only* and does not reset that game's "last deployed" date.

Statuses: Up to date · Needs deployment · Deployment failed · Deploying · Never deployed · Unverified · Local only.

## Deploying from the dashboard

**Build & Deploy** shows a preflight first: target site, affected path, changed files, build status, the exact
command, and — for shared sites — the other projects that a site-level `firebase deploy` would also publish
(you must acknowledge this). After the command succeeds Pulse waits for the new release and verifies every file
before marking the project up to date. A failed build blocks deployment.

Only commands saved in a project's settings can run. `@static` is a built-in static server for vanilla games.

## Features

Overview (stats, GitHub-style heatmap with day drill-down, pending queue, recommendations, live timeline) ·
project cards / table / list / Kanban with drag-and-drop lifecycle · per-project pages (overview, file explorer and
viewer, activity, Git, deployments, assets, dependencies, tasks, notes and PRDs, settings) · deployment queue,
reminders (1/3/7/14/30 days) and priority simulator · analytics (monthly by category, intensity ranking,
estimated development sessions, sessions vs deployments) · asset manager (previews, sprite-sheet inspector,
GLB/GLTF viewer, audio, duplicates, large files, broken references, possibly-unused assets, formats, dimension
checks, history) · shared library dependency map with impact analysis · dev-server manager with logs and
port-conflict detection · quick launcher (Explorer, VS Code, terminal, local/published game, Firebase console,
repository) · website health checks · project backups · portfolio `games.json` export · notifications ·
global search (Ctrl K) · dark and light themes.

## Data, privacy and safety

- Everything is stored in `data/project-pulse.db` (SQLite, WAL). Daily online backups go to `data/backups/database`.
- The server binds to `127.0.0.1` only, rejects foreign Host/Origin headers and requires a custom header on every
  write request (DNS-rebinding and CSRF protection).
- File access is restricted to registered project roots (canonical path + symlink checks). `.env`, keys and other
  secret files are never indexed, served or shown; tokens are redacted from logs.
- Unregistering a project removes dashboard data only — Pulse never deletes your files.
- Deployments, commands, registrations and backups are recorded in the audit log (Settings).

Excluded by default: `node_modules/ .git/ dist/ build/ .next/ .cache/ coverage/ .firebase/ temp/ *.log *.tmp`.
A deploy directory such as `dist/` is still indexed, but as build output — it feeds the deployment comparison and
never counts as development activity.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for internals. The previous prototype is kept in `legacy/`.
