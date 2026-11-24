import type { DayDetail, FileEvent, HeatmapDay, IntensityEntry, Overview } from '@pulse/shared';
import { groupSessions, intensityScore } from '@pulse/shared';
import { db, json, type Row } from '../../database/db.js';
import { daysAgoIso, localDate } from '../../util.js';
import { getSettings } from '../settings.js';
import { listProjects } from '../projects.js';
import { broadcast } from '../../websocket/hub.js';
import { runningCount } from '../process-manager/processes.js';
import { unreadCount } from '../notifications/notifications.js';
import { rowToDeployment } from '../deployment/state.js';
import { currentWs } from '../../workspace/context.js';

const MEANINGFUL = `event_type IN ('created','modified','deleted','renamed') AND COALESCE(kind,'') != 'build'`;

/** Rebuild daily_activity and development_sessions from raw events for dates >= sinceDate (YYYY-MM-DD, local). */
export function aggregate(sinceDays = 2) {
  const sinceIso = daysAgoIso(sinceDays);
  const sinceDate = localDate(sinceIso);
  const gap = getSettings().sessionGapMinutes;
  db().tx(() => {
    db().run('DELETE FROM daily_activity WHERE date >= ?', sinceDate);
    db().run(`INSERT INTO daily_activity(project_id, date, changes, assets)
      SELECT project_id, date(detected_at, 'localtime') AS d, COUNT(DISTINCT path), COUNT(DISTINCT CASE WHEN kind = 'asset' THEN path END)
      FROM file_events WHERE detected_at >= ? AND ${MEANINGFUL} GROUP BY project_id, d`, sinceIso);
    db().run(`INSERT INTO daily_activity(project_id, date, commits) SELECT project_id, date(committed_at, 'localtime') AS d, COUNT(*) FROM git_commits WHERE committed_at >= ? GROUP BY project_id, d
      ON CONFLICT(project_id, date) DO UPDATE SET commits = excluded.commits`, sinceIso);
    db().run(`INSERT INTO daily_activity(project_id, date, deployments) SELECT project_id, date(deployed_at, 'localtime') AS d, COUNT(*) FROM deployments
      WHERE deployed_at >= ? AND affects_project = 1 AND status = 'success' GROUP BY project_id, d
      ON CONFLICT(project_id, date) DO UPDATE SET deployments = excluded.deployments`, sinceIso);

    // Sessions: group meaningful events + commits separated by more than `gap` minutes
    db().run('DELETE FROM development_sessions WHERE started_at >= ?', sinceIso);
    const rows = db().all<{ project_id: string; t: string }>(`SELECT project_id, detected_at AS t FROM file_events WHERE detected_at >= ? AND (${MEANINGFUL} OR event_type = 'git_commit')
      AND COALESCE(detail, '') != 'seed:mtime' ORDER BY project_id, detected_at`, sinceIso);
    const byProject = new Map<string, number[]>();
    for (const r of rows) (byProject.get(r.project_id) ?? byProject.set(r.project_id, []).get(r.project_id)!).push(Date.parse(r.t));
    for (const [pid, times] of byProject) {
      for (const s of groupSessions(times, gap)) {
        db().run('INSERT INTO development_sessions(project_id, started_at, ended_at, events, minutes) VALUES (?, ?, ?, ?, ?)', pid, new Date(s.start).toISOString(), new Date(s.end).toISOString(), s.events, s.minutes);
        const d = localDate(s.start);
        db().run(`INSERT INTO daily_activity(project_id, date, sessions, minutes) VALUES (?, ?, 1, ?)
          ON CONFLICT(project_id, date) DO UPDATE SET sessions = sessions + 1, minutes = minutes + excluded.minutes`, pid, d, s.minutes);
      }
    }
  });
  broadcast('analytics.updated');
}

/** Retention: drop raw file events older than activityRetentionDays (daily aggregates are kept). */
export function applyRetention() {
  const days = getSettings().activityRetentionDays;
  db().run(`DELETE FROM file_events WHERE detected_at < ? AND event_type IN ('created','modified','deleted','renamed','dir_created')`, daysAgoIso(days));
}

interface Filter { projectId?: string; category?: string }
function projectFilter(f: Filter, alias = 'a') {
  const where: string[] = []; const params: string[] = [];
  if (f.projectId) { where.push(`${alias}.project_id = ?`); params.push(f.projectId); }
  if (f.category) { where.push(`${alias}.project_id IN (SELECT id FROM projects WHERE category = ?)`); params.push(f.category); }
  return { sql: where.length ? ' AND ' + where.join(' AND ') : '', params };
}

export function heatmap(f: Filter = {}, days = 371): { days: HeatmapDay[]; total: number; max: number } {
  const since = localDate(daysAgoIso(days - 1));
  const pf = projectFilter(f);
  const rows = db().all<{ date: string; n: number }>(`SELECT date, SUM(changes) AS n FROM daily_activity a WHERE date >= ?${pf.sql} GROUP BY date`, since, ...pf.params);
  const map = new Map(rows.map((r) => [r.date, r.n]));
  const nonzero = rows.map((r) => r.n).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => nonzero.length ? nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] : 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const out: HeatmapDay[] = [];
  let total = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = localDate(daysAgoIso(i));
    const n = map.get(d) ?? 0;
    total += n;
    out.push({ date: d, count: n, level: n === 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4 });
  }
  return { days: out, total, max: nonzero[nonzero.length - 1] ?? 0 };
}

export function dayDetail(date: string, f: Filter = {}): DayDetail {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
  const pf = projectFilter(f);
  const projects = db().all<Row>(`SELECT a.*, p.name FROM daily_activity a JOIN projects p ON p.id = a.project_id WHERE a.date = ?${pf.sql} ORDER BY a.changes DESC`, date, ...pf.params)
    .map((r) => ({ projectId: r.project_id, name: r.name, changes: r.changes, commits: r.commits, sessions: r.sessions, minutes: r.minutes, assets: r.assets }));
  const pfe = projectFilter(f, 'e');
  const events = db().all<Row>(`SELECT e.*, p.name AS project_name FROM file_events e JOIN projects p ON p.id = e.project_id
    WHERE date(e.detected_at, 'localtime') = ?${pfe.sql} AND e.event_type IN ('created','modified','deleted','renamed','git_commit') ORDER BY e.detected_at DESC LIMIT 500`, date, ...pfe.params).map(rowToEvent);
  const pfd = projectFilter(f, 'd');
  const deployments = db().all<Row>(`SELECT d.* FROM deployments d WHERE date(d.deployed_at, 'localtime') = ? AND d.affects_project = 1${pfd.sql} ORDER BY d.deployed_at DESC`, date, ...pfd.params).map(rowToDeployment);
  return {
    date, projects, files: events.filter((e) => e.eventType !== 'git_commit'), commits: events.filter((e) => e.eventType === 'git_commit'), deployments,
    totalChanges: projects.reduce((a, b) => a + b.changes, 0), estimatedMinutes: projects.reduce((a, b) => a + b.minutes, 0),
  };
}

export function rowToEvent(r: Row): FileEvent {
  return { id: r.id, projectId: r.project_id, projectName: r.project_name ?? undefined, path: r.path, oldPath: r.old_path ?? undefined, eventType: r.event_type, kind: r.kind ?? undefined,
    size: r.size ?? undefined, prevSize: r.prev_size ?? undefined, detail: r.detail ?? undefined, detectedAt: r.detected_at };
}

const intensityCaches = new Map<string, { at: number; window: number; data: IntensityEntry[] }>();
export function intensity(windowDays = getSettings().intensityWindowDays, fresh = false): IntensityEntry[] {
  const intensityCache = intensityCaches.get(currentWs());
  if (!fresh && intensityCache && Date.now() - intensityCache.at < 30_000 && intensityCache.window === windowDays) return intensityCache.data;
  const { intensityWeights, intensityThresholds } = getSettings();
  const since = daysAgoIso(windowDays);
  const sinceDate = localDate(since);
  const out: IntensityEntry[] = [];
  for (const p of listProjects()) {
    const changes = db().get<{ n: number }>(`SELECT COUNT(DISTINCT path) AS n FROM file_events WHERE project_id = ? AND detected_at >= ? AND ${MEANINGFUL}`, p.id, since)!.n;
    const assets = db().get<{ n: number }>(`SELECT COUNT(DISTINCT path) AS n FROM file_events WHERE project_id = ? AND detected_at >= ? AND ${MEANINGFUL} AND kind = 'asset'`, p.id, since)!.n;
    const activeDays = db().get<{ n: number }>('SELECT COUNT(*) AS n FROM daily_activity WHERE project_id = ? AND date >= ? AND (changes > 0 OR commits > 0)', p.id, sinceDate)!.n;
    const sessions = db().get<{ n: number }>('SELECT COUNT(*) AS n FROM development_sessions WHERE project_id = ? AND started_at >= ?', p.id, since)!.n;
    const git = json<{ isRepo?: boolean } | undefined>(db().get<{ git: string }>('SELECT git FROM projects WHERE id = ?', p.id)?.git, undefined);
    const commits = git?.isRepo ? db().get<{ n: number }>('SELECT COUNT(*) AS n FROM git_commits WHERE project_id = ? AND committed_at >= ?', p.id, since)!.n : null;
    const s = intensityScore({ changes, activeDays, sessions, commits, assets }, intensityWeights, intensityThresholds);
    out.push({ projectId: p.id, name: p.name, category: p.category, score: s.score, label: s.label, components: s.components, raw: { changes, activeDays, sessions, commits: commits ?? 0, assets } });
  }
  out.sort((a, b) => b.score - a.score);
  intensityCaches.set(currentWs(), { at: Date.now(), window: windowDays, data: out });
  return out;
}

export function monthly(months = 12) {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() - (months - 1));
  const rows = db().all<Row>(`SELECT substr(a.date, 1, 7) AS month, p.category, SUM(a.changes) AS changes, SUM(a.minutes) AS minutes, SUM(a.commits) AS commits
    FROM daily_activity a JOIN projects p ON p.id = a.project_id WHERE a.date >= ? GROUP BY month, p.category`, localDate(start));
  const out: Record<string, any>[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start); d.setMonth(start.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry: Record<string, any> = { month: key, label: d.toLocaleString('en', { month: 'short' }), game: 0, library: 0, application: 0, website: 0, tool: 0, minutes: 0, commits: 0 };
    for (const r of rows.filter((x) => x.month === key)) { entry[r.category] = (entry[r.category] ?? 0) + r.changes; entry.minutes += r.minutes; entry.commits += r.commits; }
    out.push(entry);
  }
  return out;
}

/** Weekly development sessions vs production deployments (detects "developing but not publishing"). */
export function deploymentFrequency(weeks = 12, projectId?: string) {
  const out = [];
  const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const thisWeek = startOfWeek(new Date());
  for (let i = weeks - 1; i >= 0; i--) {
    const s = new Date(thisWeek); s.setDate(s.getDate() - i * 7);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    const p = projectId ? ' AND project_id = ?' : '';
    const args = projectId ? [projectId] : [];
    const sessions = db().get<{ n: number; m: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(minutes),0) AS m FROM development_sessions WHERE started_at >= ? AND started_at < ?${p}`, s.toISOString(), e.toISOString(), ...args)!;
    const deployments = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM deployments WHERE deployed_at >= ? AND deployed_at < ? AND affects_project = 1 AND status = 'success'${p}`, s.toISOString(), e.toISOString(), ...args)!.n;
    out.push({ week: localDate(s), label: `${s.toLocaleString('en', { month: 'short' })} ${s.getDate()}`, sessions: sessions.n, minutes: sessions.m, deployments });
  }
  return out;
}

export function overview(): Overview {
  const ps = db().all<Row>('SELECT id, deploy_state, last_local_update, last_activity, favorite, lifecycle FROM projects');
  const inactiveBefore = daysAgoIso(getSettings().inactiveDays);
  let needs = 0, ok = 0, inactive = 0, never = 0, failed = 0, fav = 0;
  for (const p of ps) {
    const st = json<{ status?: string } | undefined>(p.deploy_state, undefined)?.status;
    if (st === 'needs_deployment') needs++;
    if (st === 'up_to_date') ok++;
    if (st === 'never_deployed') never++;
    if (st === 'deployment_failed') failed++;
    if (p.favorite) fav++;
    const last = [p.last_activity, p.last_local_update].filter(Boolean).sort().pop();
    if (!last || last < inactiveBefore || p.lifecycle === 'archived') inactive++;
  }
  const size = db().get<{ n: number }>('SELECT COALESCE(SUM(size),0) AS n FROM file_index WHERE build = 0')!.n;
  const today = db().get<{ n: number }>(`SELECT COALESCE(SUM(changes),0) AS n FROM daily_activity WHERE date = ?`, localDate())!.n;
  const c30 = db().get<{ n: number }>(`SELECT COALESCE(SUM(changes),0) AS n FROM daily_activity WHERE date >= ?`, localDate(daysAgoIso(30)))!.n;
  const m7 = db().get<{ n: number }>(`SELECT COALESCE(SUM(minutes),0) AS n FROM development_sessions WHERE started_at >= ?`, daysAgoIso(7))!.n;
  return { totalProjects: ps.length, needsDeployment: needs, upToDate: ok, inactive, neverDeployed: never, failed, favorites: fav, totalSize: size, changesToday: today, changes30d: c30, estimatedMinutes7d: m7, runningProcesses: runningCount(), unreadNotifications: unreadCount() };
}

export interface TimelineQuery { projectId?: string; category?: string; types?: string[]; from?: string; to?: string; before?: number; limit?: number; gitOnly?: boolean; deploymentStatus?: string; q?: string; includeSeeded?: boolean }
export function timeline(q: TimelineQuery): FileEvent[] {
  const where: string[] = ['1 = 1']; const params: (string | number)[] = [];
  if (q.projectId) { where.push('e.project_id = ?'); params.push(q.projectId); }
  if (q.category) { where.push('p.category = ?'); params.push(q.category); }
  if (q.gitOnly) where.push(`e.event_type = 'git_commit'`);
  if (q.types?.length) { where.push(`e.event_type IN (${q.types.map(() => '?').join(',')})`); params.push(...q.types); }
  if (q.from) { where.push('e.detected_at >= ?'); params.push(new Date(q.from).toISOString()); }
  if (q.to) { const t = new Date(q.to); if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) t.setDate(t.getDate() + 1); where.push('e.detected_at < ?'); params.push(t.toISOString()); }
  if (q.before) { where.push('e.id < ?'); params.push(q.before); }
  if (q.deploymentStatus) { where.push(`json_extract(p.deploy_state, '$.status') = ?`); params.push(q.deploymentStatus); }
  if (q.q) { where.push('(e.path LIKE ? OR e.detail LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  if (!q.includeSeeded) where.push(`COALESCE(e.detail, '') NOT LIKE 'seed:%'`);
  const limit = Math.min(q.limit ?? 200, 1000);
  return db().all<Row>(`SELECT e.*, p.name AS project_name FROM file_events e JOIN projects p ON p.id = e.project_id WHERE ${where.join(' AND ')} ORDER BY e.detected_at DESC, e.id DESC LIMIT ?`, ...params, limit).map(rowToEvent);
}

export function projectActivity(projectId: string, days = 90) {
  return db().all<Row>('SELECT date, changes, commits, sessions, minutes, assets, deployments FROM daily_activity WHERE project_id = ? AND date >= ? ORDER BY date', projectId, localDate(daysAgoIso(days)));
}
export function sessions(projectId?: string, days = 30) {
  return db().all<Row>(`SELECT s.*, p.name FROM development_sessions s JOIN projects p ON p.id = s.project_id WHERE s.started_at >= ?${projectId ? ' AND s.project_id = ?' : ''} ORDER BY s.started_at DESC LIMIT 500`,
    daysAgoIso(days), ...(projectId ? [projectId] : []));
}
