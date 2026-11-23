/**
 * Build do dist/: esbuild sbalí vstupní body jako IIFE (content scripty nesmí být ES moduly),
 * zkopíruje manifest, _locales, ikony, HTML a CSS a nakonec ověří dist/manifest.json.
 * Použití: node scripts/build.mjs [--watch]
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { verifyDist } from './verify-dist.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const isWatch = process.argv.includes('--watch');

const ENTRIES = {
  'main-world': 'src/main-world/index.js',
  content: 'src/content/index.js',
  background: 'src/background/service-worker.js',
  'popup/popup': 'src/popup/popup.js',
  'options/options': 'src/options/options.js',
};

/** [zdroj, cíl] relativně k ROOT / DIST */
const STATIC = [
  ['manifest.json', 'manifest.json'],
  ['_locales', '_locales'],
  ['icons', 'icons'],
  ['src/content/theater.css', 'content.css'],
  ['src/shared/theme.css', 'shared/theme.css'],
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
];

const buildOptions = {
  absWorkingDir: ROOT,
  entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([out, src]) => [out, join(ROOT, src)])),
  outdir: DIST,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  platform: 'browser',
  charset: 'utf8',
  minify: false,
  sourcemap: isWatch ? 'inline' : false,
  legalComments: 'inline',
  logLevel: 'info',
};

function copyStatic() {
  for (const [from, to] of STATIC) {
    const target = join(DIST, to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(ROOT, from), target, { recursive: true });
  }
}

function verifyOrReport() {
  const problems = verifyDist(DIST);
  if (problems.length > 0) {
    console.error('dist/ neprošel kontrolou:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return false;
  }
  console.log('dist/manifest.json: OK (MV3, všechny odkazované soubory existují)');
  return true;
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
copyStatic();

if (isWatch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  let timer = null;
  const recopy = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      copyStatic();
      verifyOrReport();
      console.log(`[${new Date().toLocaleTimeString()}] statické soubory zkopírovány`);
    }, 100);
  };
  for (const dir of ['src', '_locales', 'icons']) watch(join(ROOT, dir), { recursive: true }, recopy);
  watch(join(ROOT, 'manifest.json'), recopy);
  console.log('Sleduji změny… (Ctrl+C ukončí)');
} else {
  await esbuild.build(buildOptions);
  if (!verifyOrReport()) process.exit(1);
}
