/**
 * The pictures of the README (screenshots/*.png): the popup and the settings as they really look, in English, light and
 * dark. Starts Brave (or BROWSER_PATH) with a temporary profile, loads dist/ and takes the pictures over CDP.
 * Run: npm run build && node scripts/screenshots.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, Session } from '../tests/e2e/cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'screenshots');
const BROWSER =
  process.env.BROWSER_PATH ?? join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'hemitube-shots-'));
const { child, cdp } = launch(BROWSER, [
  `--user-data-dir=${profile}`,
  '--enable-unsafe-extension-debugging',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--lang=en-US',
  '--window-size=1280,900',
  'about:blank',
]);

async function open(url, width, height) {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = new Session(cdp, sessionId);
  s.targetId = targetId;
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await s.waitFor(`document.readyState === 'complete'`, { timeout: 30000 });
  return s;
}

async function shot(s, file, dark, height) {
  // a tab in the background is not painted: the picture would never come
  await cdp.send('Target.activateTarget', { targetId: s.targetId });
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await sleep(600);
  const h = height ?? (await s.evaluate('Math.ceil(document.body.scrollHeight)'));
  const { data } = await s.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: await s.evaluate('document.documentElement.clientWidth'), height: h, scale: 1 }, captureBeyondViewport: true });
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  console.log(`screenshots/${file}`);
}

try {
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: DIST });
  // the defaults are written by the service worker at the install
  const options = await open(`chrome-extension://${id}/options/options.html`, 900, 1000);
  await options.waitFor(`(async () => !!(await chrome.storage.sync.get('settings')).settings)()`, { timeout: 30000 });
  const popup = await open(`chrome-extension://${id}/popup/popup.html`, 340, 200);
  await sleep(800);
  await shot(popup, 'popup-dark.png', true);
  await shot(popup, 'popup-light.png', false);
  await options.evaluate('location.reload()');
  await options.waitFor(`document.readyState === 'complete'`);
  await sleep(800);
  await shot(options, 'settings-dark.png', true, 1000);
  await shot(options, 'settings-light.png', false, 1000);
} finally {
  try { await cdp.send('Browser.close'); } catch { child.kill(); }
  await sleep(1500);
  rmSync(profile, { recursive: true, force: true });
}
