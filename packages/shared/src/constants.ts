export const CATEGORIES = ['game', 'library', 'application', 'website', 'tool'] as const;
export type Category = (typeof CATEGORIES)[number];

export const LIFECYCLES = [
  'concept', 'prototype', 'development', 'alpha', 'beta', 'released', 'maintenance', 'on_hold', 'archived',
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  concept: 'Concept', prototype: 'Prototype', development: 'In development', alpha: 'Alpha', beta: 'Beta',
  released: 'Released', maintenance: 'Maintenance', on_hold: 'On hold', archived: 'Archived',
};

export const DEPLOYMENT_STATUSES = [
  'up_to_date', 'needs_deployment', 'deployment_failed', 'deploying', 'never_deployed', 'unverified', 'local_only',
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  up_to_date: 'Up to date', needs_deployment: 'Needs deployment', deployment_failed: 'Deployment failed',
  deploying: 'Deploying', never_deployed: 'Never deployed', unverified: 'Unverified', local_only: 'Local only',
};

export const DEFAULT_EXCLUDES = [
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.cache/', 'coverage/', '.firebase/', 'temp/', '*.log', '*.tmp',
];

/** Files that must never be read, hashed for display or served. */
export const SECRET_PATTERNS = [
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', '*service-account*.json', '*serviceAccount*.json', '*-firebase-adminsdk-*.json', '.npmrc',
];

export const PROJECT_MARKERS = [
  'package.json', 'index.html', 'firebase.json', '.firebaserc', '.git', 'vite.config.js', 'vite.config.ts', 'go.mod', 'README.md', 'pulse.json', '.pulse.json',
];

export const ASSET_TYPES = ['image', 'animation', 'audio', 'video', 'model', 'vfx', 'font', 'script', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const EXT_KIND: Record<string, 'source' | 'asset' | 'doc' | 'config'> = {};
const SOURCE_EXT = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'go', 'py', 'glsl', 'frag', 'vert', 'wgsl', 'json5', 'lua', 'cs', 'rs', 'c', 'cpp', 'h'];
const ASSET_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'mp4', 'webm', 'mov', 'glb', 'gltf', 'fbx', 'obj', 'blend', 'ttf', 'otf', 'woff', 'woff2', 'atlas', 'plist'];
const DOC_EXT = ['md', 'markdown', 'txt', 'pdf', 'docx'];
const CONFIG_EXT = ['json', 'yml', 'yaml', 'toml', 'xml', 'ini', 'lock'];
for (const e of SOURCE_EXT) EXT_KIND[e] = 'source';
for (const e of ASSET_EXT) EXT_KIND[e] = 'asset';
for (const e of DOC_EXT) EXT_KIND[e] = 'doc';
for (const e of CONFIG_EXT) EXT_KIND[e] = 'config';

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'];
export const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
export const VIDEO_EXT = ['mp4', 'webm', 'mov'];
export const MODEL_EXT = ['glb', 'gltf', 'fbx', 'obj', 'blend'];
export const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];

export const WS_EVENTS = [
  'project.updated', 'project.removed', 'file.created', 'file.modified', 'file.deleted', 'file.renamed', 'git.updated',
  'deployment.started', 'deployment.completed', 'deployment.failed', 'analytics.updated', 'notification.created',
  'process.started', 'process.stopped', 'process.output', 'scan.progress',
] as const;
export type WsEventType = (typeof WS_EVENTS)[number];

export const INTENSITY_LABELS: { min: number; label: string }[] = [
  { min: 80, label: 'Very active' }, { min: 60, label: 'Active' }, { min: 40, label: 'Moderate' }, { min: 20, label: 'Low activity' }, { min: 0, label: 'Dormant' },
];
export function intensityLabel(score: number): string {
  return INTENSITY_LABELS.find((l) => score >= l.min)?.label ?? 'Dormant';
}

export const REMINDER_DAY_OPTIONS = [1, 3, 7, 14, 30];
