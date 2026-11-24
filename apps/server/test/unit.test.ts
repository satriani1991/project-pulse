import { describe, expect, it } from 'vitest';
import { deploymentPriority, groupSessions, intensityScore } from '@pulse/shared';
import { compareManifests, compareWithBaseline, subsetForPath, subtreeDigest } from '../src/services/deployment/compare.js';
import { compileIgnore, globToRe } from '../src/security/ignore.js';
import { isSecretFile, redact } from '../src/security/secrets.js';
import { parseImageSize } from '../src/services/assets/image-info.js';
import { assetType } from '../src/services/assets/image-info.js';

describe('intensity score', () => {
  it('normalises against thresholds and caps at 100', () => {
    expect(intensityScore({ changes: 600, activeDays: 40, sessions: 60, commits: 80, assets: 100 }).score).toBe(100);
    expect(intensityScore({ changes: 0, activeDays: 0, sessions: 0, commits: 0, assets: 0 }).score).toBe(0);
  });
  it('does not penalise non-Git projects', () => {
    const git = intensityScore({ changes: 300, activeDays: 20, sessions: 30, commits: 0, assets: 50 });
    const noGit = intensityScore({ changes: 300, activeDays: 20, sessions: 30, commits: null, assets: 50 });
    expect(git.score).toBe(85);
    expect(noGit.score).toBe(100);
    expect(noGit.components.commits).toBeNull();
  });
  it('labels classification bands', () => {
    expect(intensityScore({ changes: 300, activeDays: 20, sessions: 30, commits: null, assets: 50 }).label).toBe('Very active');
    expect(intensityScore({ changes: 0, activeDays: 1, sessions: 0, commits: null, assets: 0 }).label).toBe('Dormant');
  });
});

describe('deployment priority', () => {
  it('matches the PRD example (5 days, 24 files, medium → 50, deploy soon)', () => {
    expect(deploymentPriority({ daysPending: 5, changedFiles: 24, importance: 'medium', buildHasErrors: false })).toEqual({ score: 50, recommendation: 'Deploy soon', blocked: false });
  });
  it('blocks on build errors', () => {
    const r = deploymentPriority({ daysPending: 20, changedFiles: 80, importance: 'critical', buildHasErrors: true });
    expect(r.blocked).toBe(true); expect(r.recommendation).toMatch(/Fix build/);
  });
  it('nothing to deploy without changes', () => expect(deploymentPriority({ daysPending: 9, changedFiles: 0, importance: 'high', buildHasErrors: false }).score).toBe(0));
});

describe('session grouping', () => {
  it('starts a new session after a gap > 15 minutes', () => {
    const m = 60_000;
    const s = groupSessions([0, 5 * m, 14 * m, 40 * m, 41 * m], 15);
    expect(s.length).toBe(2);
    expect(s[0].minutes).toBe(14);
    expect(s[1].minutes).toBe(5); // minimum credit
  });
});

describe('manifest comparison', () => {
  const local = [
    { remote: '/games/tka/index.html', rel: 'index.html', hash: 'L1', gzip: 'G1', size: 1, mtimeMs: 0 },
    { remote: '/games/tka/main.js', rel: 'main.js', hash: 'L2', gzip: 'G2x', size: 1, mtimeMs: 0 },
    { remote: '/games/tka/new.png', rel: 'new.png', hash: 'L3', gzip: 'G3', size: 1, mtimeMs: 0 },
  ];
  const remote = new Map([['/games/tka/index.html', 'G1'], ['/games/tka/main.js', 'G2'], ['/games/tka/old.png', 'G9']]);
  it('detects added, modified and deleted files when gzip hashing is validated', () => {
    const r = compareManifests(local, remote, () => false, () => undefined);
    expect(r.matched).toBe(1); expect(r.gzipValidated).toBe(true);
    expect(r.added.map((x) => x.path)).toEqual(['new.png']);
    expect(r.modified.map((x) => x.path)).toEqual(['main.js']);
    expect(r.deleted.map((x) => x.path)).toEqual(['/games/tka/old.png']);
  });
  it('marks undecidable files unverified when no gzip hash matched', () => {
    const r = compareManifests(local.map((f) => ({ ...f, gzip: 'zzz' })), remote, () => false, () => undefined);
    expect(r.unverified.length).toBe(2); expect(r.modified.length).toBe(0);
  });
  it('uses verified hash pairs and known content hashes', () => {
    const r = compareManifests(local.map((f) => ({ ...f, gzip: undefined })), remote, (l, rh) => l === 'L1' && rh === 'G1', (rh) => (rh === 'G2' ? ['OLD'] : undefined));
    expect(r.matched).toBe(1); expect(r.modified.map((x) => x.path)).toEqual(['main.js']);
  });
  it('baseline comparison is exact', () => {
    const r = compareWithBaseline(local, new Map([['/games/tka/index.html', 'L1'], ['/games/tka/main.js', 'OLD'], ['/games/tka/gone.js', 'X']]));
    expect([r.added.length, r.modified.length, r.deleted.length, r.matched]).toEqual([1, 1, 1, 1]);
  });
  it('isolates a project subtree on a shared site (PRD §6.4)', () => {
    const site = new Map([['/games/tka/a.js', '1'], ['/games/court-legends/a.js', '2'], ['/index.html', '3'], ['/games/index.html', '4']]);
    expect([...subsetForPath(site, '/games/tka/').keys()]).toEqual(['/games/tka/a.js']);
    // a root project must not claim files owned by deeper project paths
    expect([...subsetForPath(site, '/', ['/games/tka/', '/games/court-legends/']).keys()].sort()).toEqual(['/games/index.html', '/index.html']);
  });
  it('subtree digest changes only when that subtree changes', () => {
    const v1 = new Map([['/games/tka/a.js', '1'], ['/games/cl/a.js', '2']]);
    const v2 = new Map([['/games/tka/a.js', '1'], ['/games/cl/a.js', '3']]);
    expect(subtreeDigest(subsetForPath(v1, '/games/tka/'))).toBe(subtreeDigest(subsetForPath(v2, '/games/tka/')));
    expect(subtreeDigest(subsetForPath(v1, '/games/cl/'))).not.toBe(subtreeDigest(subsetForPath(v2, '/games/cl/')));
  });
});

describe('ignore rules & secrets', () => {
  const m = compileIgnore(['node_modules/', 'dist/', '*.log', 'assets/raw/', '/temp/']);
  it('matches directories by name and path', () => {
    expect(m.dir('a/node_modules', 'node_modules')).toBe(true);
    expect(m.dir('assets/raw', 'raw')).toBe(true);
    expect(m.dir('src/raw', 'raw')).toBe(false);
    expect(m.dir('temp', 'temp')).toBe(true);
    expect(m.file('x/debug.log', 'debug.log')).toBe(true);
    expect(m.file('src/main.js', 'main.js')).toBe(false);
  });
  it('firebase-style globs', () => {
    expect(globToRe('**/.*').test('assets/.DS_Store')).toBe(true);
    expect(globToRe('**/.*').test('index.html')).toBe(false);
    expect(globToRe('**/node_modules/**').test('a/node_modules/x/y.js')).toBe(true);
  });
  it('blocks secrets and redacts tokens', () => {
    expect(isSecretFile('.env')).toBe(true);
    expect(isSecretFile('config/.env.production')).toBe(true);
    expect(isSecretFile('keys/my-firebase-adminsdk-abc.json')).toBe(true);
    expect(isSecretFile('src/env.js')).toBe(false);
    expect(redact('Bearer ya29.abcDEF_123 token: supersecretvalue')).not.toMatch(/ya29\.abc|supersecretvalue/);
  });
});

describe('asset helpers', () => {
  it('reads PNG and GIF dimensions from headers', () => {
    const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(2048, 16); png.writeUInt32BE(1536, 20);
    expect(parseImageSize(png)).toEqual({ width: 2048, height: 1536 });
    const gif = Buffer.alloc(32); gif.write('GIF89a'); gif.writeUInt16LE(300, 6); gif.writeUInt16LE(200, 8);
    expect(parseImageSize(gif)).toEqual({ width: 300, height: 200 });
    expect(parseImageSize(Buffer.from('<svg width="64" height="32"></svg>'))).toEqual({ width: 64, height: 32 });
  });
  it('classifies asset types', () => {
    expect(assetType('assets/sprites/knight.png', 'png')).toBe('animation');
    expect(assetType('assets/vfx/fire.png', 'png')).toBe('vfx');
    expect(assetType('assets/bg.webp', 'webp')).toBe('image');
    expect(assetType('models/dragon.glb', 'glb')).toBe('model');
    expect(assetType('sfx/hit.ogg', 'ogg')).toBe('audio');
  });
});
