import { HOST, PORT, DATA_DIR, DISABLE_JOBS } from './config.js';
import { closeDb, db } from './database/db.js';
import { buildApp } from './app.js';
import { registerHooks } from './services/orchestrator.js';
import { startBackground, stopBackground } from './jobs/scheduler.js';
import { closeAll } from './services/watcher/watcher.js';
import { stopAll } from './services/process-manager/processes.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`PROJECT PULSE needs Node.js 22.13 or newer (built-in SQLite). Found ${process.version}.`);
  process.exit(1);
}

async function main() {
  db();
  registerHooks();
  const app = await buildApp();
  await app.listen({ host: HOST, port: PORT });
  console.log(`\n  PROJECT PULSE  →  http://${HOST}:${PORT}\n  data: ${DATA_DIR}\n`);
  if (!DISABLE_JOBS) startBackground().catch((e) => console.error('[startup]', e));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    console.log('Stopping PROJECT PULSE…');
    stopBackground();
    await closeAll();
    await stopAll();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGBREAK' as NodeJS.Signals, shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
