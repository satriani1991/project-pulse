// Mock Firebase Hosting REST API (v1beta1 subset) for end-to-end testing of deployment comparison.
// Usage: node mock-firebase.mjs <port> <stateFile>
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';

const port = Number(process.argv[2] || 7799);
const stateFile = process.argv[3] || '/tmp/mock-firebase.json';
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { sites: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
export const gzHash = (buf) => crypto.createHash('sha256').update(zlib.gzipSync(buf, { level: 9 })).digest('hex');

/** Publish a directory map: { "/games/tka/": "/abs/local/dir", ... } merged onto the previous version. */
function release(site, mounts, opts = {}) {
  const s = (state.sites[site] ??= { releases: [], versions: {} });
  const prev = s.releases[0] ? { ...s.versions[s.releases[0].version.name] } : {};
  const files = opts.replace ? {} : prev;
  for (const [prefix, dir] of Object.entries(mounts)) {
    for (const k of Object.keys(files)) if (k.startsWith(prefix)) delete files[k];
    const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, rel + e.name + '/'); else files[prefix + rel + e.name] = gzHash(fs.readFileSync(f)); } };
    walk(dir);
  }
  for (const [p, content] of Object.entries(opts.override ?? {})) files[p] = gzHash(Buffer.from(content));
  const id = crypto.randomBytes(6).toString('hex');
  const vname = `sites/${site}/versions/${id}`;
  s.versions[vname] = files;
  const t = opts.time ?? new Date().toISOString();
  s.releases.unshift({ name: `sites/${site}/releases/${id}`, type: 'DEPLOY', releaseTime: t, releaseUser: { email: 'dev@example.com' }, version: { name: vname, status: 'FINALIZED', fileCount: String(Object.keys(files).length) } });
  save();
  return { id, files: Object.keys(files).length };
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && url.pathname === '/admin/release') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const j = JSON.parse(b); send(200, release(j.site, j.mounts, j)); }); return;
  }
  if (req.headers.authorization !== 'Bearer test-token') return send(401, { error: { message: 'bad token' } });
  let m = /^\/v1beta1\/sites\/([^/]+)\/releases$/.exec(url.pathname);
  if (m) { const s = state.sites[m[1]]; if (!s) return send(404, { error: { message: 'site not found' } }); return send(200, { releases: s.releases.slice(0, Number(url.searchParams.get('pageSize') || 25)) }); }
  m = /^\/v1beta1\/(sites\/[^/]+\/versions\/[^/]+)\/files$/.exec(url.pathname);
  if (m) {
    const site = m[1].split('/')[1]; const files = state.sites[site]?.versions[m[1]]; if (!files) return send(404, { error: { message: 'version not found' } });
    const all = Object.entries(files).map(([p, hash]) => ({ path: p, hash, status: 'EXPECTED' }));
    const size = Number(url.searchParams.get('pageSize') || 1000); const start = Number(url.searchParams.get('pageToken') || 0);
    return send(200, { files: all.slice(start, start + size), nextPageToken: start + size < all.length ? String(start + size) : undefined });
  }
  send(404, { error: { message: 'not found ' + url.pathname } });
}).listen(port, '127.0.0.1', () => console.log('mock firebase on ' + port));
