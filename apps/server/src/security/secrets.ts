import { SECRET_PATTERNS } from '@pulse/shared';
import { compileIgnore } from './ignore.js';

const secretMatcher = compileIgnore(SECRET_PATTERNS);
export const isSecretFile = (rel: string) => { const name = rel.split('/').pop() || rel; return secretMatcher.file(rel, name); };

const TOKEN_RES = [
  /ya29\.[0-9A-Za-z_\-]+/g, // Google OAuth access tokens
  /1\/\/[0-9A-Za-z_\-]{20,}/g, // Google refresh tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(api[_-]?key|token|secret|password)(["'\s:=]+)[^\s"',]{8,}/gi,
  /AIza[0-9A-Za-z_\-]{35}/g,
];
/** Remove anything that looks like a credential before it is logged, stored or sent to the browser. */
export function redact(text: string): string {
  let out = text;
  for (const re of TOKEN_RES) out = out.replace(re, (_m, k, sep) => (typeof k === 'string' && typeof sep === 'string' ? `${k}${sep}[redacted]` : '[redacted]'));
  return out;
}
