import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  minify: process.env.NODE_ENV === 'production',
};

// Testes unitarios (npm test): so o dominio e afins, rodam no Node puro com
// `node --test`. Nao apaga o resto do dist — o app continua utilizavel.
if (process.argv.includes('--tests')) {
  const unitDir = resolve(root, 'src/test/unit');
  const unitOut = resolve(out, 'test/unit');
  rmSync(unitOut, { recursive: true, force: true });
  await build({
    ...common,
    logLevel: 'warning',
    entryPoints: readdirSync(unitDir)
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => resolve(unitDir, file)),
    outdir: unitOut,
    platform: 'node',
    external: ['electron', 'node-pty'],
  });
  process.exit(0);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await Promise.all([
  // Main e preload rodam em Node: electron e node-pty ficam externos
  // (node-pty carrega um .node nativo que nao pode ser empacotado).
  build({
    ...common,
    entryPoints: [resolve(root, 'src/main/main.ts')],
    outfile: resolve(out, 'main/main.js'),
    platform: 'node',
    external: ['electron', 'node-pty'],
  }),
  build({
    ...common,
    entryPoints: [resolve(root, 'src/main/preload.ts')],
    outfile: resolve(out, 'preload/preload.js'),
    platform: 'node',
    external: ['electron'],
  }),
  // Teste de integracao headless (npm run smoke).
  build({
    ...common,
    entryPoints: [resolve(root, 'src/test/pty-smoke.ts')],
    outfile: resolve(out, 'test/pty-smoke.js'),
    platform: 'node',
    external: ['electron', 'node-pty'],
  }),
  // Renderer roda no Chromium: xterm e addons entram no bundle.
  build({
    ...common,
    entryPoints: [resolve(root, 'src/renderer/index.ts')],
    outfile: resolve(out, 'renderer/renderer.js'),
    platform: 'browser',
    target: 'chrome128',
  }),
]);

// Assets estaticos do renderer.
cpSync(resolve(root, 'src/renderer/index.html'), resolve(out, 'renderer/index.html'));
cpSync(resolve(root, 'src/renderer/styles.css'), resolve(out, 'renderer/styles.css'));
cpSync(
  resolve(root, 'node_modules/@xterm/xterm/css/xterm.css'),
  resolve(out, 'renderer/xterm.css'),
);

if (!watch) console.log('build -> dist/');
