import type { Importance, PriorityInput, PriorityResult, Settings } from './types.js';
import { intensityLabel } from './constants.js';

export const DEFAULT_SETTINGS: Settings = {
  debounceMs: 3000,
  sessionGapMinutes: 15,
  inactiveDays: 30,
  reminderDays: 7,
  firebaseCheckMinutes: 5,
  gitRefreshSeconds: 60,
  healthCheckMinutes: 15,
  reconcileMinutes: 60,
  analyticsMinutes: 15,
  activityRetentionDays: 730,
  globalExcludes: [],
  largeAssetKB: 1024,
  intensityWeights: { changes: 30, activeDays: 25, sessions: 20, commits: 15, assets: 10 },
  intensityThresholds: { changes: 300, activeDays: 20, sessions: 30, commits: 40, assets: 50 },
  intensityWindowDays: 30,
  firebaseAuth: 'auto',
  serviceAccountPath: '',
  firebaseApiBase: 'https://firebasehosting.googleapis.com/v1beta1',
  portfolioExportPath: '',
  editorCommand: 'code',
  terminalCommand: 'wt',
  backupDays: 1,
  theme: 'dark',
  allowFileDeletion: false,
  remoteVerifyMaxMB: 200,
};

export interface IntensityRaw { changes: number; activeDays: number; sessions: number; commits: number | null; assets: number }

/**
 * Weighted 0–100 development intensity. Each component is normalised against its threshold (capped at 1).
 * When commits is null (non-Git project) its weight is removed and the remaining weights re-normalised,
 * so non-Git projects are not penalised.
 */
export function intensityScore(raw: IntensityRaw, weights = DEFAULT_SETTINGS.intensityWeights, thresholds = DEFAULT_SETTINGS.intensityThresholds) {
  const keys = ['changes', 'activeDays', 'sessions', 'commits', 'assets'] as const;
  let wsum = 0, total = 0;
  const components: Record<string, number | null> = {};
  for (const k of keys) {
    const v = raw[k];
    if (v === null) { components[k] = null; continue; }
    const t = Math.max(thresholds[k], 1e-9);
    const c = Math.min(v / t, 1);
    components[k] = Math.round(c * 100);
    wsum += weights[k];
    total += weights[k] * c;
  }
  const score = wsum > 0 ? Math.round((100 * total) / wsum) : 0;
  return { score, label: intensityLabel(score), components: components as { changes: number; activeDays: number; sessions: number; commits: number | null; assets: number } };
}

const IMPORTANCE_POINTS: Record<Importance, number> = { low: 5, medium: 15, high: 25, critical: 35 };

/** Rule-based deployment priority (0–100). A failed build blocks the recommendation from becoming an action. */
export function deploymentPriority(i: PriorityInput): PriorityResult {
  if (i.changedFiles <= 0) return { score: 0, recommendation: 'Nothing to deploy', blocked: i.buildHasErrors };
  const days = Math.min(i.daysPending / 10, 1) * 35;
  const files = Math.min(i.changedFiles / 40, 1) * 30;
  const score = Math.min(100, Math.floor(days + files + IMPORTANCE_POINTS[i.importance]));
  if (i.buildHasErrors) return { score, recommendation: 'Fix build errors before deploying', blocked: true };
  const recommendation = score >= 75 ? 'Deploy now' : score >= 50 ? 'Deploy soon' : score >= 25 ? 'Schedule deployment' : 'Low priority';
  return { score, recommendation, blocked: false };
}

/** Group sorted timestamps (ms) into sessions separated by gaps larger than gapMinutes. */
export function groupSessions(times: number[], gapMinutes: number, minSessionMinutes = 5) {
  const sorted = [...times].sort((a, b) => a - b);
  const gap = gapMinutes * 60_000;
  const sessions: { start: number; end: number; events: number }[] = [];
  for (const t of sorted) {
    const last = sessions[sessions.length - 1];
    if (last && t - last.end <= gap) { last.end = t; last.events++; } else sessions.push({ start: t, end: t, events: 1 });
  }
  // Estimated duration: span plus a minimum credit for each session (a single save still represents some work).
  return sessions.map((s) => ({ ...s, minutes: Math.max(minSessionMinutes, Math.round((s.end - s.start) / 60_000)) }));
}
