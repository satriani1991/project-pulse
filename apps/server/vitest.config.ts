import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', pool: 'forks', testTimeout: 20000, env: { PULSE_DB: ':memory:', PULSE_DISABLE_JOBS: '1' } } });
