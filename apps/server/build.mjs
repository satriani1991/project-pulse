import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  packages: 'external',
  // bundle the workspace package; everything else stays in node_modules
  plugins: [{ name: 'bundle-shared', setup(b) { b.onResolve({ filter: /^@pulse\/shared$/ }, () => ({ path: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })); } }],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
