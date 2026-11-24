import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-it-'));
process.env.PULSE_DATA = path.join(tmp, 'data');
const ws = path.join(tmp, 'ws');
const write = (p: string, s: string) => { fs.mkdirSync(path.dirname(path.join(ws, p)), { recursive: true }); fs.writeFileSync(path.join(ws, p), s); };

let mod: typeof import('./integration-helpers.js');
beforeAll(async () => {
  write('Game/index.html', '<title>My Game</title><canvas></canvas>');
  write('Game/src/a.js', 'a'); write('Game/node_modules/x/y.js', 'x'); write('Game/.env', 'S=1'); write('Game/dist/out.js', 'built');
  write('Libs/Engine/package.json', JSON.stringify({ name: 'engine', main: 'i.js' })); write('Libs/Engine/i.js', 'e');
  mod = await import('./integration-helpers.js');
});

describe('registration, scanning and change detection', () => {
  it('discovers projects and prevents duplicates', async () => {
    const found = mod.discover(ws);
    expect(found.map((f) => f.name).sort()).toEqual(['Engine', 'My Game']);
    const p = mod.createProject({ rootPath: path.join(ws, 'Game'), category: 'game', deployment: { provider: 'firebase', hostingSiteId: 's', remotePath: 'games/g', deployDirectory: '.' } });
    expect(p.deployment?.remotePath).toBe('/games/g/');
    expect(() => mod.createProject({ rootPath: path.join(ws, 'Game') })).toThrow(/already registered/);
    expect(() => mod.createProject({ rootPath: 'relative/path' })).toThrow(/absolute/);
  });

  it('indexes files excluding dependencies, build output and secrets; then detects add/modify/delete/rename', async () => {
    const p = mod.listProjects()[0];
    await mod.scanProject(p.id);
    const paths = () => mod.db().all<{ path: string }>('SELECT path FROM file_index WHERE project_id = ? ORDER BY path', p.id).map((r) => r.path);
    expect(paths()).toEqual(['index.html', 'src/a.js']);
    write('Game/src/b.js', 'b'); fs.writeFileSync(path.join(ws, 'Game/src/a.js'), 'a2'); fs.renameSync(path.join(ws, 'Game/index.html'), path.join(ws, 'Game/main.html'));
    const r = await mod.scanProject(p.id);
    expect(r!.created).toEqual(['src/b.js']);
    expect(r!.modified).toEqual(['src/a.js']);
    expect(r!.renamed).toEqual([{ from: 'index.html', to: 'main.html' }]);
    // touching a file without changing content is not a meaningful change
    const f = path.join(ws, 'Game/src/b.js'); const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t);
    const r2 = await mod.scanProject(p.id);
    expect(r2!.modified).toEqual([]);
    fs.unlinkSync(f);
    expect((await mod.scanProject(p.id))!.deleted).toEqual(['src/b.js']);
  });

  it('unregistering never touches the directory', () => {
    const p = mod.listProjects()[0];
    mod.deleteProject(p.id);
    expect(fs.existsSync(path.join(ws, 'Game/src/a.js'))).toBe(true);
  });

  it('rejects path traversal outside the project root', () => {
    expect(() => mod.resolveInside(path.join(ws, 'Game'), '../Libs/Engine/i.js')).toThrow(/outside/);
    expect(() => mod.resolveInside(path.join(ws, 'Game'), '.env')).toThrow(/secret/);
    expect(mod.resolveInside(path.join(ws, 'Game'), 'src/a.js')).toBe(path.join(ws, 'Game/src/a.js'));
  });

  it('isolates workspaces: projects and settings are separate per workspace', () => {
    const office = mod.createWorkspace({ name: 'Office' });
    expect(mod.listWorkspaces().map((w) => w.id)).toEqual(['default', office.id]);
    mod.runInWorkspace(office.id, () => {
      expect(mod.listProjects()).toEqual([]);
      mod.createProject({ rootPath: path.join(ws, 'Libs/Engine'), category: 'library' });
      mod.updateSettings({ debounceMs: 4000 });
    });
    // the same folder may be registered in another workspace without conflict
    mod.createProject({ rootPath: path.join(ws, 'Libs/Engine') });
    expect(mod.runInWorkspace(office.id, () => mod.listProjects().map((p) => p.name))).toEqual(['Engine']);
    expect(mod.runInWorkspace(office.id, () => mod.getSettings().debounceMs)).toBe(4000);
    expect(mod.getSettings().debounceMs).toBe(3000);
    expect(() => mod.createWorkspace({ name: 'office' })).toThrow(/already exists/);
  });
});
