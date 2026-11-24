import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { getSettings } from '../settings.js';
import { IS_WIN } from '../../config.js';

/**
 * Firebase Hosting REST API credentials. Tokens stay in memory and are never logged or sent to the browser.
 * Supported sources (in "auto" order):
 *   1. Service-account JSON key (settings.serviceAccountPath or GOOGLE_APPLICATION_CREDENTIALS)
 *   2. Firebase CLI login (`firebase login`) — reuses the CLI's cached access token / refresh token
 *   3. Google Cloud CLI (`gcloud auth print-access-token`)
 */
let cache: { token: string; exp: number; source: string } | undefined;
let lastError = '';

const SCOPES = 'https://www.googleapis.com/auth/firebase.readonly https://www.googleapis.com/auth/cloud-platform';
// Public OAuth client used by firebase-tools to refresh its own login (not a secret; ships in the CLI source).
const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

export async function getAccessToken(): Promise<string> {
  if (process.env.PULSE_FIREBASE_TOKEN) { cache = { token: process.env.PULSE_FIREBASE_TOKEN, exp: Date.now() + 3600_000, source: 'env' }; return cache.token; } // test / CI override
  if (cache && cache.exp - 60_000 > Date.now()) return cache.token;
  const mode = getSettings().firebaseAuth;
  const order = mode === 'auto' ? ['service_account', 'firebase_cli', 'gcloud'] : [mode];
  const errors: string[] = [];
  for (const m of order) {
    try {
      const t = m === 'service_account' ? await fromServiceAccount() : m === 'firebase_cli' ? await fromFirebaseCli() : await fromGcloud();
      if (t) { cache = { ...t, source: m }; lastError = ''; return t.token; }
    } catch (e) { errors.push(`${m}: ${(e as Error).message}`); }
  }
  lastError = errors.join('; ') || 'No Firebase credentials found';
  throw new Error('Firebase authentication unavailable — ' + lastError);
}

export function authStatus() {
  return { source: cache?.source, valid: !!cache && cache.exp > Date.now(), lastError, mode: getSettings().firebaseAuth };
}
export function clearTokenCache() { cache = undefined; }

async function fromServiceAccount() {
  const p = getSettings().serviceAccountPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) return undefined;
  const key = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (key.type !== 'service_account') throw new Error('Not a service-account key file');
  const iat = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: SCOPES, aud: key.token_uri, iat, exp: iat + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const r = await fetch(key.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  if (!r.ok) throw new Error(`token exchange HTTP ${r.status}`);
  const j: any = await r.json();
  return { token: j.access_token as string, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

async function fromFirebaseCli() {
  const file = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(file)) return undefined;
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tokens = cfg.tokens ?? {};
  if (tokens.access_token && tokens.expires_at && tokens.expires_at - 120_000 > Date.now()) return { token: tokens.access_token as string, exp: tokens.expires_at as number };
  if (!tokens.refresh_token) throw new Error('firebase-tools has no stored login (run `firebase login`)');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: FIREBASE_CLI_CLIENT_ID, client_secret: FIREBASE_CLI_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`refresh HTTP ${r.status} (run \`firebase login --reauth\`)`);
  const j: any = await r.json();
  return { token: j.access_token as string, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

function fromGcloud(): Promise<{ token: string; exp: number } | undefined> {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN ? 'gcloud.cmd' : 'gcloud';
    execFile(cmd, ['auth', 'print-access-token'], { timeout: 20_000, windowsHide: true, shell: IS_WIN }, (err, stdout) => {
      if (err) return reject(new Error('gcloud not available or not logged in'));
      const token = stdout.trim();
      if (!token) return reject(new Error('gcloud returned no token'));
      resolve({ token, exp: Date.now() + 45 * 60_000 });
    });
  });
}
