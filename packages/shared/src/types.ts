import type { AssetType, Category, DeploymentStatus, Lifecycle } from './constants.js';

export interface DeploymentConfig {
  provider: 'firebase' | 'none';
  firebaseProjectId: string;
  hostingSiteId: string;
  /** Path on the hosting site that this project's deployable files live under, e.g. /games/tka/ */
  remotePath: string;
  publicUrl: string;
  /** Local directory (relative to project root) whose contents are published at remotePath. */
  deployDirectory: string;
}

export interface ProjectCommands {
  dev?: string;
  build?: string;
  deploy?: string;
  [custom: string]: string | undefined;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  rootPath: string;
  thumbnailPath?: string;
  category: Category;
  lifecycle: Lifecycle;
  technologies: string[];
  tags: string[];
  monitoringEnabled: boolean;
  gitEnabled: boolean;
  deploymentMonitoring: boolean;
  favorite: boolean;
  importance: Importance;
  genre?: string;
  version?: string;
  repoUrl?: string;
  devUrl?: string;
  devPort?: number;
  deployment?: DeploymentConfig;
  commands: ProjectCommands;
  ignoreRules: string[];
  lastLocalUpdate?: string;
  lastActivity?: string;
  lastDeployment?: string;
  lastScanAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type Importance = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectStats {
  totalFiles: number;
  totalSize: number;
  sourceSize: number;
  assetSize: number;
  sourceFiles: number;
  assetFiles: number;
  filesChangedToday: number;
  filesChangedSinceDeployment: number | null;
  sessions30d: number;
  estimatedMinutes30d: number;
}

export interface GitSnapshot {
  isRepo: boolean;
  branch?: string;
  commitHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitDate?: string;
  dirtyCount: number;
  ahead?: number;
  behind?: number;
  remoteUrl?: string;
  files?: { path: string; status: string }[];
  checkedAt?: string;
  error?: string;
}

export interface DeploymentState {
  status: DeploymentStatus;
  method: 'manifest' | 'baseline' | 'timestamp' | 'none';
  confidence: 'verified' | 'partial' | 'hint' | 'none';
  pendingCount: number;
  added: number;
  modified: number;
  deleted: number;
  unverifiedFiles: number;
  pendingSince?: string;
  checkedAt?: string;
  message?: string;
  siteReleaseTime?: string;
  releaseId?: string;
  versionId?: string;
  error?: string;
}

export interface ProjectSummary extends Project {
  stats: ProjectStats;
  git?: GitSnapshot;
  deploymentState: DeploymentState;
  intensity: number;
  health?: HealthCheck;
  errors: string[];
}

export interface PendingChange { path: string; change: 'added' | 'modified' | 'deleted' | 'unverified'; size?: number; modifiedAt?: string }

export interface Deployment {
  id: number;
  projectId: string;
  source: 'firebase' | 'manual' | 'dashboard';
  releaseId?: string;
  versionId?: string;
  deployedAt: string;
  deployedBy?: string;
  status: 'success' | 'failed' | 'unknown' | 'running';
  message?: string;
  /** Whether this release changed this project's subtree (shared-site aware). */
  affectsProject: boolean;
  fileCount?: number;
  localVersion?: string;
}

export interface FileEvent {
  id: number;
  projectId: string;
  projectName?: string;
  path: string;
  oldPath?: string;
  eventType: 'created' | 'modified' | 'deleted' | 'renamed' | 'dir_created' | 'asset_updated' | 'git_commit' | 'build_completed' | 'deployment' | 'registered' | 'command';
  kind?: string;
  size?: number;
  prevSize?: number;
  detail?: string;
  detectedAt: string;
}

export interface FileEntry { path: string; size: number; modifiedAt: string; kind: string; hash?: string }

export interface Asset {
  path: string;
  type: AssetType;
  ext: string;
  size: number;
  width?: number;
  height?: number;
  hash?: string;
  modifiedAt: string;
}

export interface AssetReport {
  counts: Record<AssetType, number>;
  sizes: Record<AssetType, number>;
  total: number;
  totalSize: number;
  duplicates: { hash: string; size: number; files: { projectId: string; path: string }[] }[];
  large: (Asset & { projectId: string })[];
  broken: { projectId: string; source: string; reference: string }[];
  unused: { projectId: string; path: string; size: number }[];
  formats: { ext: string; count: number; size: number }[];
  dimensionIssues: { projectId: string; folder: string; sizes: string[]; files: number }[];
  recent: FileEvent[];
}

export interface HeatmapDay { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }
export interface DayDetail {
  date: string;
  projects: { projectId: string; name: string; changes: number; commits: number; sessions: number; minutes: number; assets: number }[];
  files: FileEvent[];
  commits: FileEvent[];
  deployments: Deployment[];
  totalChanges: number;
  estimatedMinutes: number;
}

export interface IntensityEntry {
  projectId: string;
  name: string;
  category: Category;
  score: number;
  label: string;
  components: { changes: number; activeDays: number; sessions: number; commits: number | null; assets: number };
  raw: { changes: number; activeDays: number; sessions: number; commits: number; assets: number };
}

export interface Overview {
  totalProjects: number;
  needsDeployment: number;
  upToDate: number;
  inactive: number;
  neverDeployed: number;
  failed: number;
  favorites: number;
  totalSize: number;
  changesToday: number;
  changes30d: number;
  estimatedMinutes7d: number;
  runningProcesses: number;
  unreadNotifications: number;
}

export interface Recommendation {
  id: string;
  projectId?: string;
  projectName?: string;
  rule: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  action?: { label: string; kind: 'deploy' | 'build' | 'commit' | 'open' | 'view' | 'backup'; target?: string };
  priority?: number;
}

export interface PriorityInput { daysPending: number; changedFiles: number; importance: Importance; buildHasErrors: boolean }
export interface PriorityResult { score: number; recommendation: string; blocked: boolean }

export interface Task { id: number; projectId: string | null; title: string; status: 'todo' | 'doing' | 'done'; priority: 'low' | 'medium' | 'high'; dueDate?: string; createdAt: string; updatedAt: string }
export interface Note { id: number; projectId: string; title: string; content: string; kind: 'note' | 'idea' | 'bug' | 'tech' | 'prd'; createdAt: string; updatedAt: string }
export interface Notification { id: number; projectId?: string; projectName?: string; type: string; message: string; createdAt: string; readAt?: string }

export interface ManagedProcess {
  id: string;
  projectId: string;
  projectName: string;
  command: string;
  commandKey: string;
  port?: number;
  pid?: number;
  status: 'running' | 'stopped' | 'exited' | 'failed';
  exitCode?: number | null;
  startedAt: string;
  endedAt?: string;
  url?: string;
}

export interface DependencyEdge { id?: number; projectId: string; dependencyId: string; version?: string; source: 'package' | 'import' | 'copy' | 'manual' | 'workspace'; detail?: string }

export interface HealthCheck { url: string; ok: boolean; status?: number; latencyMs?: number; checkedAt: string; error?: string; bytes?: number }

export interface Settings {
  debounceMs: number;
  sessionGapMinutes: number;
  inactiveDays: number;
  reminderDays: number;
  firebaseCheckMinutes: number;
  gitRefreshSeconds: number;
  healthCheckMinutes: number;
  reconcileMinutes: number;
  analyticsMinutes: number;
  activityRetentionDays: number;
  globalExcludes: string[];
  largeAssetKB: number;
  intensityWeights: { changes: number; activeDays: number; sessions: number; commits: number; assets: number };
  intensityThresholds: { changes: number; activeDays: number; sessions: number; commits: number; assets: number };
  intensityWindowDays: number;
  firebaseAuth: 'auto' | 'gcloud' | 'service_account' | 'firebase_cli';
  serviceAccountPath: string;
  firebaseApiBase: string;
  portfolioExportPath: string;
  editorCommand: string;
  terminalCommand: string;
  backupDays: number;
  theme: 'dark' | 'light';
  allowFileDeletion: boolean;
  remoteVerifyMaxMB: number;
}

export interface DiscoveredProject {
  rootPath: string;
  name: string;
  category: Category;
  technologies: string[];
  markers: string[];
  alreadyRegistered: boolean;
  nested: boolean;
  deployment?: Partial<DeploymentConfig>;
  commands: ProjectCommands;
  description?: string;
  version?: string;
  thumbnailPath?: string;
}

export interface DeployPreflight {
  projectId: string;
  site?: string;
  firebaseProjectId?: string;
  remotePath?: string;
  deployDirectory?: string;
  changes: PendingChange[];
  buildCommand?: string;
  deployCommand?: string;
  buildStatus: 'ok' | 'stale' | 'failed' | 'none' | 'unknown';
  sharedSiteProjects: { id: string; name: string; remotePath: string; status: DeploymentStatus }[];
  warnings: string[];
  blocked: boolean;
  confirmToken: string;
}

export interface PortfolioEntry {
  id: string; title: string; category: string; genre?: string; description?: string; version?: string;
  thumbnail?: string; url?: string; status: Lifecycle; releaseDate?: string; technologies: string[];
}

export type WsMessage = { type: string; projectId?: string; data?: unknown; at: string };
