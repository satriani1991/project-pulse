import { db, now } from '../database/db.js';
import { redact } from './secrets.js';

export function audit(action: string, projectId: string | null, detail: unknown) {
  db().run('INSERT INTO audit_log(action, project_id, detail, at) VALUES (?, ?, ?, ?)', action, projectId, redact(typeof detail === 'string' ? detail : JSON.stringify(detail)), now());
}
export function auditLog(limit = 200) {
  return db().all('SELECT a.*, p.name AS project_name FROM audit_log a LEFT JOIN projects p ON p.id = a.project_id ORDER BY a.id DESC LIMIT ?', limit);
}
