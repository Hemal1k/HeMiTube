/**
 * End-to-end test HeMiTube v Brave (nebo jiném Chromiu) na živém YouTube.
 *
 * - Spustí prohlížeč s DOČASNÝM profilem (tvůj profil zůstane nedotčený) a načte dist/
 *   přes CDP Extensions.loadUnpacked (vyžaduje --enable-unsafe-extension-debugging + pipe).
 * - Dialog o cookies odmítne („Odmítnout vše“ / „Reject all“).
 * - Nastavení mění přes stránku nastavení rozšíření (chrome.storage.sync), stejně jako uživatel.
 *
 * Spuštění: npm run build && npm run e2e
 * Jiný prohlížeč: BROWSER_PATH="C:\...\chrome.exe" npm run e2e
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, Session } from './cdp.mjs';
import { screenQuality } from '../../src/shared/quality-logic.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const BROWSER =
  process.env.BROWSER_PATH ?? join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
const VIDEO = 'dQw4w9WgXcQ'; // 4K remaster, 25 fps, veřejné
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nbsp = (text) => (typeof text === 'string' ? text.replaceAll(String.fromCharCode(0xa0), ' ') : text);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok === true ? 'OK  ' : ok === null ? 'SKIP' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` – ${detail}` : ''}`);
}
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null;
async function step(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (error) {
    if (error.skip) record(name, null, error.message);
    else record(name, false, error.message.slice(0, 6000));
  }
}
const skip = (message) => Object.assign(new Error(message), { skip: true });
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rydDislikes(videoId) {
  const response = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`);
  const json = await response.json();
  return json.dislikes;
}
const formatCs = (n) => nbsp(new Intl.NumberFormat('cs', { notation: 'compact', compactDisplay: 'short' }).format(n));

/**
 * Očekávaný počet: hodnota, kterou si doplněk pro dané video uložil do cache (chrome.storage.session).
 * Počty v RYD se u nových videí mění během sekund, takže nové stažení z API by test zbytečně shazovalo.
 * Když v cache nic není (ještě), použije se API.
 */
async function expectedDislikes(videoId) {
  const key = 'ryd:v:' + videoId;
  for (let i = 0; i < 20; i++) {
    const cached = await ext.evaluate(`chrome.storage.session.get(${JSON.stringify(key)}).then((r) => r[${JSON.stringify(key)}]?.d?.dislikes ?? null)`).catch(() => null);
    if (typeof cached === 'number') return cached;
    await sleep(500);
  }
  return rydDislikes(videoId);
}

// ---------------------------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'ytk-e2e-'));
const { child, cdp, getStderr } = launch(BROWSER, [
  `--user-data-dir=${profile}`,
  '--enable-unsafe-extension-debugging',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--lang=cs',
  '--window-size=1280,900',
  // Překryté nebo neaktivní okno nesmí YouTube uspat (jinak se video nenačte).
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  'about:blank',
]);
const errors = [];
const downloads = [];
cdp.on((message) => {
  if (message.method === 'Browser.downloadWillBegin') downloads.push({ guid: message.params.guid, name: message.params.suggestedFilename, state: 'started' });
  if (message.method === 'Browser.downloadProgress') {
    const item = downloads.find((d) => d.guid === message.params.guid);
    if (item) Object.assign(item, { state: message.params.state, bytes: message.params.receivedBytes });
  }
});
let page;
let ext;
let extensionId;

async function attach(targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return new Session(cdp, sessionId);
}

cdp.on((message) => {
  if (!page || message.sessionId !== page.sessionId) return;
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    const text = `${details.exception?.description ?? details.text} @ ${details.url ?? ''}`;
    if (/chrome-extension:|ytk/i.test(text)) errors.push(text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    const url = message.params.stackTrace?.callFrames?.[0]?.url ?? '';
    if (/chrome-extension:/.test(url) || /ytk/i.test(text)) errors.push(`${text} @ ${url}`);
  }
});

async function rejectConsent() {
  for (let i = 0; i < 16; i++) {
    const clicked = await page
      .evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button, [role=button]')];
        const reject = buttons.find((b) => /^(reject all|odmítnout vše)$/i.test(b.textContent.trim()) ||
          /^(reject the use|odmítnout používání)/i.test(b.getAttribute('aria-label') || ''));
        if (reject) { reject.click(); return true; }
        return false;
      })()`)
      .catch(() => false);
    if (clicked) {
      await sleep(3000);
      return true;
    }
    const ready = await page.evaluate(`!!document.querySelector('#movie_player, ytd-app')`).catch(() => false);
    if (ready && i > 6) return false;
    await sleep(500);
  }
  return false;
}

/** Hlavní karta testu; když ji prohlížeč zavře (např. první spuštění profilu), vytvoří se nová. */
let pageTarget = null;
async function openPage() {
  // Použít kartu, kterou Brave otevřel při startu (about:blank), a nevytvářet další prázdnou.
  // Novou kartu otevřít jen tehdy, když žádná použitelná není (např. ji někdo zavřel).
  const { targetInfos } = await cdp.send('Target.getTargets');
  const startTab = targetInfos.find((target) => target.type === 'page' && target.url === 'about:blank' && !target.attached);
  ({ targetId: pageTarget } = startTab ?? (await cdp.send('Target.createTarget', { url: 'about:blank' })));
  for (const target of targetInfos) {
    if (target.type === 'page' && target.url === 'about:blank' && target.targetId !== pageTarget) {
      await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
    }
  }
  page = await attach(pageTarget);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await cdp.send('Target.activateTarget', { targetId: pageTarget });
}

/** Okno do normálního stavu (ne minimalizované) a karta s testem do popředí. */
async function bringToFront() {
  const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: pageTarget }).catch(() => ({}));
  if (windowId) await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
  await cdp.send('Target.activateTarget', { targetId: pageTarget }).catch(() => {});
  await page.send('Page.bringToFront').catch(() => {});
}

async function goto(url) {
  // YouTube na kartě na pozadí video nenačte → karta s testem vždy do popředí.
  await bringToFront();
  try {
    await page.send('Page.navigate', { url });
  } catch (error) {
    if (!/Session with given id not found|No target/i.test(error.message)) throw error;
    console.log('       (hlavní karta zmizela – otevírám novou)');
    await openPage();
    await page.send('Page.navigate', { url });
  }
  await sleep(1500);
  await rejectConsent();
  await page.waitFor(`document.readyState !== 'loading'`);
}

async function diagnose(label) {
  const state = await page
    .evaluate(`(() => { const p = document.querySelector('#movie_player'); const v = p && p.querySelector('video');
      return { url: location.href, title: document.title, player: !!p, api: !!(p && p.getVideoData),
        videoId: p && p.getVideoData && p.getVideoData().video_id, readyState: v && v.readyState, paused: v && v.paused,
        hidden: document.hidden, body: document.body && document.body.innerText.slice(0, 300) }; })()`)
    .catch((error) => ({ error: error.message }));
  const shot = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot && process.env.E2E_SHOT_DIR) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(process.env.E2E_SHOT_DIR, `${label}.png`), Buffer.from(shot.data, 'base64'));
  }
  return state;
}

async function diagnoseExt(label) {
  const shot = await ext.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot && process.env.E2E_SHOT_DIR) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(process.env.E2E_SHOT_DIR, `${label}.png`), Buffer.from(shot.data, 'base64'));
  }
}

async function playerReady(videoId, timeout = 30000) {
  try {
    await playerReadyInner(videoId, timeout);
  } catch (error) {
    throw new Error(`${error.message}\n    stav: ${JSON.stringify(await diagnose(`player-${videoId}`))}`, { cause: error });
  }
}

async function playerReadyInner(videoId, timeout) {
  await bringToFront();
  await page.waitFor(
    `(() => { const p = document.querySelector('#movie_player'); const v = p && p.querySelector('video');
      return !!(p && v && v.readyState >= 2 && p.getVideoData && p.getVideoData().video_id === ${JSON.stringify(videoId)}); })()`,
    { timeout, label: `přehrávač s videem ${videoId}` },
  );
  await page.evaluate(`document.querySelector('#movie_player video').play().catch(() => {}), true`);
}

/** Změna nastavení jako z UI (chrome.storage.sync); patch = { modul: { klíč: hodnota } } */
async function patchSettings(patch) {
  return ext.evaluate(`(async () => {
    const stored = (await chrome.storage.sync.get('settings')).settings;
    const patch = ${JSON.stringify(patch)};
    for (const [section, values] of Object.entries(patch)) Object.assign(stored[section], values);
    await chrome.storage.sync.set({ settings: stored });
    return stored;
  })()`);
}

async function status() {
  return ext.evaluate(`(async () => {
    for (const tab of await chrome.tabs.query({})) {
      try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'ytk:getStatus' }); if (r && r.ok) return r; } catch {}
    }
    return null;
  })()`);
}

try {
  // ---- 1. Načtení rozšíření ----
  await step('Brave spuštěn a rozšíření načteno (Extensions.loadUnpacked)', async () => {
    const version = await cdp.send('Browser.getVersion');
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    extensionId = loaded.id;
    assert(extensionId, 'chybí ID rozšíření');
    return `${version.product}, id ${extensionId}`;
  });
  if (!extensionId) throw new Error(`Rozšíření se nenačetlo. stderr: ${getStderr()}`);

  await openPage();

  const { targetId: extTarget } = await cdp.send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/options/options.html`,
    background: true,
  });
  ext = await attach(extTarget);
  await ext.waitFor(`document.readyState === 'complete' && !!chrome.storage`, { timeout: 45000, label: 'stránka nastavení načtená' });
  await ext.waitFor(`(async () => !!(await chrome.storage.sync.get('settings')).settings)()`, {
    label: 'výchozí nastavení zapsané service workerem (onInstalled)',
  });

  // ---- 2. Stránka nastavení ----
  await step('Stránka nastavení: české texty, 3 kodeky, světlý/tmavý motiv', async () => {
    const info = await ext.evaluate(`({ h1: document.querySelector('h1').textContent, lang: document.documentElement.lang,
      codecs: document.querySelectorAll('#codec-list li').length, selects: document.querySelectorAll('select option').length })`);
    assert(info.h1.includes('nastavení'), `nadpis: ${info.h1}`);
    assert(info.codecs === 3, `kodeků: ${info.codecs}`);
    assert(info.selects > 20, 'selecty nejsou naplněné');
    return `„${info.h1}“, lang=${info.lang}`;
  });

  await step('Nastavení: upozornění na obnovení jen u voleb, které ho potřebují', async () => {
    const change = (selector, value) =>
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e.type === 'checkbox') e.checked = ${JSON.stringify(value)}; else e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change')); return true; })()`;
    const toastState = `(() => { const t = document.getElementById('toast'); return t.classList.contains('show') && { info: t.classList.contains('info'), text: t.textContent }; })()`;
    try {
      const intro = await ext.evaluate(`!!document.querySelector('[data-i18n="optionsIntro"], [data-i18n="hintCodecReload"]')`);
      assert(!intro, 'úvodní text nebo stálá lišta o kodecích pořád na stránce');
      await ext.evaluate(change('[data-setting="theater.fullWindow"]', false));
      const plain = await ext.waitFor(toastState, { timeout: 3000, label: 'zpráva po běžné změně' });
      assert(!plain.info, `běžná volba hlásí obnovení: ${plain.text}`);
      await ext.evaluate(change('[data-setting="theater.fullWindow"]', true));
      await sleep(2000);
      await ext.evaluate(change('[data-setting="quality.fps"]', 'cap30'));
      const reload = await ext.waitFor(`(${toastState}) && (${toastState}).info && (${toastState})`, { timeout: 3000, label: 'upozornění po změně FPS' });
      assert(/obnovení/.test(reload.text), `text: ${reload.text}`);
      await diagnoseExt('options-reload-toast');
      await ext.evaluate(change('[data-setting="quality.fps"]', 'none'));
      await sleep(500);
      await ext.evaluate(change('[data-setting="codecs.enabled"]', true));
      await sleep(500);
      await ext.evaluate(`document.querySelector('#codec-list li[data-codec="av1"] input').click(), true`);
      const codec = await ext.waitFor(`(${toastState}) && (${toastState}).info && (${toastState})`, { timeout: 3000, label: 'upozornění po vypnutí kodeku' });
      return `běžná volba: „${plain.text}“, FPS/kodek: „${codec.text}“`;
    } finally {
      await patchSettings({ quality: { fps: 'none' }, codecs: { enabled: false, disabled: [] }, theater: { fullWindow: true } });
    }
  });

  await step('Popup: rychlá volba kvality a kodeků, odkaz na pokročilá nastavení', async () => {
    const { targetId } = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup/popup.html`,
      background: true,
    });
    const popup = await attach(targetId);
    const getSettings = `chrome.storage.sync.get('settings').then((r) => r.settings)`;
    try {
      await popup.waitFor(
        `document.querySelectorAll('#quality-preferred option').length === 11 && document.querySelectorAll('#codec-chips button').length === 3`,
        { label: 'ovládací prvky popupu' },
      );
      const ui = await popup.evaluate(`({ title: document.querySelector('h1').textContent,
        button: document.querySelector('#open-options').textContent, oldLink: !!document.querySelector('#options-link'),
        fpsOptions: document.querySelectorAll('#quality-fps option').length,
        codecsHidden: document.querySelector('[data-sub=codecs]').hidden, qualityHidden: document.querySelector('[data-sub=quality]').hidden,
        speedHidden: document.querySelector('#playback-speed').hidden, tiles: document.querySelectorAll('.tile').length,
        qualityOptions: [...document.querySelectorAll('#quality-preferred option')].map((o) => o.textContent).slice(0, 2) })`);
      assert(ui.title === 'HeMiTube', `název: ${ui.title}`);
      assert(ui.button.includes('Pokročilá nastavení') && !ui.oldLink, `tlačítko: ${ui.button}, starý odkaz: ${ui.oldLink}`);
      assert(ui.fpsOptions === 2, `voleb FPS: ${ui.fpsOptions}`);
      assert(!ui.qualityHidden && ui.codecsHidden && ui.speedHidden, 'rychlé volby se nezobrazují podle stavu modulů');
      assert(ui.tiles === 4, `dlaždic: ${ui.tiles}`);
      assert(ui.qualityOptions[0] === 'Podle obrazovky', `první volba kvality: ${ui.qualityOptions[0]}`);

      await popup.evaluate(`(() => { const s = document.querySelector('#quality-preferred'); s.value = '1080'; s.dispatchEvent(new Event('change')); return true; })()`);
      await ext.waitFor(`${getSettings}.then((s) => s.quality.preferred === '1080')`, { timeout: 5000, label: 'kvalita 1080 uložena' });

      await popup.evaluate(`(() => { const c = document.querySelector('input[data-module=codecs]'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
      await popup.waitFor(`!document.querySelector('[data-sub=codecs]').hidden`, { timeout: 5000, label: 'volby kodeků zobrazené' });
      // Chromium omezuje popup na 600 px: se všemi rozbalenými volbami, stavem přehrávání a lištou obnovení se musí vejít.
      await popup.evaluate(`(() => { const c = document.querySelector('input[data-module=playback]'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
      await popup.waitFor(`!document.querySelector('#playback-speed').hidden`, { timeout: 5000, label: 'výběr rychlosti zobrazený' });
      const popupHeight = await popup.evaluate(`(() => {
        document.getElementById('status-empty').hidden = true;
        document.getElementById('status-list').hidden = false;
        document.getElementById('reload-notice').hidden = false;
        const height = Math.ceil(document.body.getBoundingClientRect().bottom);
        document.getElementById('status-list').hidden = true;
        document.getElementById('reload-notice').hidden = true;
        document.getElementById('status-empty').hidden = false;
        return height;
      })()`);
      assert(popupHeight <= 600, `popup je vysoký ${popupHeight} px (limit 600)`);
      await popup.evaluate(`document.querySelector('#codec-chips button[data-codec=av1]').click(), true`);
      await ext.waitFor(`${getSettings}.then((s) => s.codecs.enabled && s.codecs.disabled.includes('av1'))`, { timeout: 5000, label: 'AV1 vypnuto' });
      await popup.waitFor(`document.querySelector('#codec-chips button[data-codec=av1]').getAttribute('aria-pressed') === 'false'`, { timeout: 5000 });

      // Poslední povolený kodek nejde vypnout.
      await popup.evaluate(`document.querySelector('#codec-chips button[data-codec=vp9]').click(), true`);
      await ext.waitFor(`${getSettings}.then((s) => s.codecs.disabled.includes('vp9'))`, { timeout: 5000 });
      await popup.waitFor(`document.querySelector('#codec-chips button[data-codec=h264]').getAttribute('aria-pressed') === 'true'`, { timeout: 5000 });
      await popup.evaluate(`document.querySelector('#codec-chips button[data-codec=h264]').click(), true`);
      const message = await popup.waitFor(`document.querySelector('#codec-message').textContent`, { timeout: 3000 });
      const stored = await ext.evaluate(getSettings);
      assert(!stored.codecs.disabled.includes('h264'), 'vypnuly se všechny kodeky');
      return `výška ${popupHeight} px ≤ 600, kvalita 1080 a AV1+VP9 vypnuté uloženy, poslední kodek chráněn („${message}“)`;
    } finally {
      await patchSettings({ quality: { preferred: 'screen' }, codecs: { enabled: false, disabled: [] }, hideShorts: { enabled: false }, playback: { enabled: false } });
      await cdp.send('Target.closeTarget', { targetId });
    }
  });

  await step('Popup ↔ pokročilá nastavení ukazují stejné hodnoty (oba směry, bez obnovení)', async () => {
    const { targetId } = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup/popup.html`,
      background: true,
    });
    const popup = await attach(targetId);
    const change = (selector, value) =>
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e.type === 'checkbox') e.checked = ${JSON.stringify(value)}; else e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change')); return true; })()`;
    try {
      await popup.waitFor(`document.querySelectorAll('#quality-fps option').length === 2`);
      // popup → pokročilá nastavení
      await popup.evaluate(change('#quality-fps', 'cap30'));
      await ext.waitFor(`document.querySelector('[data-setting="quality.fps"]').value === 'cap30'`, { timeout: 5000, label: 'FPS v nastavení' });
      await popup.evaluate(change('#quality-preferred', '1440'));
      await ext.waitFor(`document.querySelector('[data-setting="quality.preferred"]').value === '1440'`, { timeout: 5000, label: 'kvalita v nastavení' });
      await popup.evaluate(change('input[data-module=hideShorts]', true));
      await ext.waitFor(`document.querySelector('[data-setting="hideShorts.enabled"]').checked`, { timeout: 5000, label: 'Shorts v nastavení' });
      // pokročilá nastavení → popup
      await ext.evaluate(change('[data-setting="quality.preferred"]', '720'));
      await popup.waitFor(`document.querySelector('#quality-preferred').value === '720'`, { timeout: 5000, label: 'kvalita v popupu' });
      await ext.evaluate(change('[data-setting="quality.fps"]', 'none'));
      await popup.waitFor(`document.querySelector('#quality-fps').value === 'none'`, { timeout: 5000, label: 'FPS v popupu' });
      await ext.evaluate(change('[data-setting="playback.speed"]', '1.5'));
      await popup.waitFor(`document.querySelector('#playback-speed').value === '1.5'`, { timeout: 5000, label: 'rychlost v popupu' });
      await popup.evaluate(change('input[data-module=hideShorts]', false));
      await ext.waitFor(`!document.querySelector('[data-setting="hideShorts.enabled"]').checked`, { timeout: 5000, label: 'Shorts vypnuté v nastavení' });
      await popup.waitFor(`document.querySelector('input[data-module=hideShorts]').closest('.tile').querySelector('.tile-state').textContent === 'Vypnuto'`, {
        timeout: 5000,
        label: 'stav dlaždice Shorts',
      });
      // Režim kina v popupu = jeden přepínač (modul + automatické spouštění).
      await popup.evaluate(change('#theater-toggle', true));
      await ext.waitFor(
        `document.querySelector('[data-setting="theater.enabled"]').checked && document.querySelector('[data-setting="theater.autoTheater"]').checked`,
        { timeout: 5000, label: 'kino + auto-kino v nastavení' },
      );
      await ext.evaluate(change('[data-setting="theater.autoTheater"]', false));
      await popup.waitFor(`!document.querySelector('#theater-toggle').checked`, { timeout: 5000, label: 'přepínač kina v popupu po vypnutí auto-kina' });
      await popup.evaluate(change('#theater-toggle', true));
      await popup.evaluate(change('#theater-toggle', false));
      await ext.waitFor(
        `!document.querySelector('[data-setting="theater.enabled"]').checked && !document.querySelector('[data-setting="theater.autoTheater"]').checked`,
        { timeout: 5000, label: 'kino vypnuté v nastavení' },
      );
      return 'FPS, kvalita, Shorts a moduly se propisují oběma směry';
    } finally {
      await patchSettings({
        quality: { preferred: 'screen', fps: 'none' },
        hideShorts: { enabled: false, redirect: false },
        theater: { enabled: true, autoTheater: false },
        playback: { enabled: false, speed: '1.25' },
      });
      await cdp.send('Target.closeTarget', { targetId });
    }
  });

  // ---- 3. Stránka sledování ----
  await goto(`https://www.youtube.com/watch?v=${VIDEO}`);
  await playerReady(VIDEO);
  await cdp.send('Target.activateTarget', { targetId: pageTarget });

  await step('MAIN world skript běží na stránce', async () => {
    // Bez značky na window (N-L5): běh MAIN worldu se pozná podle obaleného addSourceBuffer.
    const wrapped = await page.evaluate(`!Function.prototype.toString.call(MediaSource.prototype.addSourceBuffer).includes('[native code]')`);
    assert(wrapped, 'MAIN world neobalil addSourceBuffer');
    const leaked = await page.evaluate(`Object.getOwnPropertySymbols(window).map(String).filter((s) => /ytk/.test(s))`);
    assert(leaked.length === 0, `na window zůstal symbol: ${leaked}`);
  });

  await step('Dislajky: počet z RYD vedle „Nelíbí se mi“ ve formátu cs', async () => {
    const expected = formatCs(await expectedDislikes(VIDEO));
    const text = nbsp(await page.waitFor(`document.querySelector('.ytk-dislike-text')?.textContent`, { timeout: 15000 }));
    const swapped = await page.evaluate(
      `!!document.querySelector('dislike-button-view-model button.ytSpecButtonShapeNextIconLeading, dislike-button-view-model button.yt-spec-button-shape-next--icon-leading')`,
    );
    assert(text === expected, `zobrazeno „${text}“, API „${expected}“`);
    assert(swapped, 'tlačítko nepřepnuto na variantu s textem');
    return `„${text}“`;
  });

  await step('Kvalita: výchozí „Podle obrazovky“ nepřekročí obrazovku, „Max dostupná“ vezme nejvyšší', async () => {
    const screen = await page.evaluate(`Math.round(screen.height * devicePixelRatio)`);
    const expectedHeight = Number(screenQuality(screen));
    const expected = await page.evaluate(`(() => {
      const data = document.querySelector('#movie_player').getAvailableQualityData().filter((d) => d.quality !== 'auto');
      const height = (d) => parseInt(d.qualityLabel, 10);
      return (data.find((d) => height(d) <= ${expectedHeight}) || data[data.length - 1]).quality;
    })()`);
    await page.waitFor(`document.querySelector('#movie_player').getPlaybackQuality() === ${JSON.stringify(expected)}`, {
      timeout: 15000,
      label: `kvalita podle obrazovky ${expected}`,
    });
    const best = await page.evaluate(`document.querySelector('#movie_player').getAvailableQualityData().filter(d => d.quality !== 'auto')[0].quality`);
    await patchSettings({ quality: { preferred: 'max' } });
    await page.waitFor(`document.querySelector('#movie_player').getPlaybackQuality() === ${JSON.stringify(best)}`, { timeout: 10000, label: `max ${best}` });
    await patchSettings({ quality: { preferred: 'screen' } });
    await page.waitFor(`document.querySelector('#movie_player').getPlaybackQuality() === ${JSON.stringify(expected)}`, { timeout: 10000, label: 'zpět podle obrazovky' });
    return `obrazovka ${screen} px → ${expected}, max → ${best}`;
  });

  await step('Popup stav: kodek, rozlišení, kvalita', async () => {
    const s = await status();
    assert(s, 'žádná odpověď z content scriptu');
    assert(['av1', 'vp9', 'h264'].includes(s.videoCodec), `videoCodec: ${s.videoCodec}`);
    assert(s.width > 0 && s.height > 0, 'rozlišení 0');
    return `${s.videoCodec}+${s.audioCodec}, ${s.width}×${s.height}, ${s.quality}, fps ${s.fps}`;
  });

  await step('Režim kina přes celé okno + skrytá lišta + letterbox', async () => {
    // Výchozí stav modulu (předchozí testy přepínají kino v popupu asynchronně).
    await patchSettings({ theater: { enabled: true, fullWindow: true, hideMasthead: true, revealMasthead: 'hover', autoTheater: false } });
    await page.waitFor(`document.documentElement.hasAttribute('ytk-full-window') && document.documentElement.hasAttribute('ytk-hide-masthead')`, {
      timeout: 5000,
      label: 'nastavení kina na stránce',
    });
    // YouTube napojí obsluhu tlačítka kina se zpožděním → případně kliknout znovu.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await page.evaluate(`document.querySelector('ytd-watch-flexy').hasAttribute('theater')`)) break;
      await page.evaluate(`document.querySelector('#movie_player .ytp-size-button').click(), true`);
      await sleep(1500);
    }
    await page.waitFor(`document.documentElement.hasAttribute('ytk-in-theater')`, { label: 'atribut ytk-in-theater' });
    await sleep(1200);
    const m = await page.evaluate(`(() => {
      const c = document.querySelector('#player-full-bleed-container').getBoundingClientRect();
      const v = document.querySelector('#movie_player video').getBoundingClientRect();
      return { innerH: innerHeight, cTop: c.top, cH: c.height, vTop: v.top - c.top, vH: v.height, vW: v.width,
        masthead: document.querySelector('#masthead-container').getBoundingClientRect().bottom };
    })()`);
    assert(Math.abs(m.cH - m.innerH) <= 1 && Math.abs(m.cTop) <= 1, `kontejner ${m.cH}px od ${m.cTop}, okno ${m.innerH}px`);
    assert(m.masthead <= 1, `lišta viditelná (bottom ${m.masthead})`);
    assert(Math.abs(m.vTop - (m.cH - m.vH) / 2) <= 3, `video není vycentrované (top ${m.vTop}, výška ${m.vH})`);
    return `kontejner ${Math.round(m.cH)} px = okno, video ${Math.round(m.vW)}×${Math.round(m.vH)} vycentrované`;
  });

  await step('Lišta se ukáže po najetí myší nahoru a po odjetí skryje', async () => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 3 });
    await page.waitFor(`document.documentElement.hasAttribute('ytk-masthead-visible')`, { timeout: 3000, label: 'lišta zobrazená' });
    await sleep(400);
    const bottom = await page.evaluate(`document.querySelector('#masthead-container').getBoundingClientRect().bottom`);
    assert(bottom > 40, `lišta nevyjela (bottom ${bottom})`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 500 });
    await page.waitFor(`!document.documentElement.hasAttribute('ytk-masthead-visible')`, { timeout: 3000, label: 'lišta skrytá' });
  });

  await step('Scroll ke komentářům pod přehrávačem', async () => {
    await page.evaluate(`window.scrollTo(0, innerHeight * 1.5), true`);
    await sleep(800);
    const y = await page.evaluate(`window.scrollY`);
    await page.evaluate(`window.scrollTo(0, 0), true`);
    assert(y > 500, `scrollY ${y}`);
    return `scrollY ${Math.round(y)}`;
  });

  await step('Změna kvality v nastavení se projeví bez obnovení (480p)', async () => {
    await patchSettings({ quality: { preferred: '480' } });
    await page.waitFor(`document.querySelector('#movie_player').getPlaybackQuality() === 'large'`, { timeout: 10000, label: 'kvalita large' });
    await patchSettings({ quality: { preferred: 'screen' } });
  });

  await step('Vypnutí modulu kina vrátí původní vzhled bez obnovení', async () => {
    await patchSettings({ theater: { enabled: false } });
    await page.waitFor(`!document.documentElement.hasAttribute('ytk-in-theater')`, { timeout: 5000 });
    await sleep(500);
    const m = await page.evaluate(`({ cH: document.querySelector('#player-full-bleed-container').getBoundingClientRect().height, innerH: innerHeight,
      masthead: document.querySelector('#masthead-container').getBoundingClientRect().bottom })`);
    assert(m.cH < m.innerH - 10 && m.masthead > 40, `kontejner ${m.cH}, lišta ${m.masthead}`);
    const stillTheater = await page.evaluate(`document.querySelector('ytd-watch-flexy').hasAttribute('theater')`);
    assert(!stillTheater, 'po vypnutí modulu zůstalo video v kině YouTube');
    await patchSettings({ theater: { enabled: true } });
    await page.evaluate(`document.querySelector('#movie_player .ytp-size-button').click(), true`);
    await page.waitFor(`document.documentElement.hasAttribute('ytk-in-theater')`, { timeout: 8000 });
    return 'vypnutí vrátí běžné zobrazení i z kina YouTube';
  });

  // ---- Nové funkce ----
  await step('Režim kina z popupu se hned projeví i na otevřeném videu (zapnutí i vypnutí)', async () => {
    const inTheater = `document.querySelector('ytd-watch-flexy').hasAttribute('theater')`;
    await patchSettings({ theater: { enabled: true, autoTheater: false } });
    if (await page.evaluate(inTheater)) {
      await page.evaluate(`document.querySelector('#movie_player .ytp-size-button').click(), true`);
      await page.waitFor(`!(${inTheater})`, { timeout: 5000 });
    }
    // Stejně jako dlaždice „Režim kina“ v popupu: modul + automatické spouštění najednou.
    await patchSettings({ theater: { enabled: true, autoTheater: true } });
    await page.waitFor(inTheater, { timeout: 8000, label: 'po zapnutí v kině' });
    await page.waitFor(`document.documentElement.hasAttribute('ytk-in-theater')`, { timeout: 5000 });
    await patchSettings({ theater: { enabled: false, autoTheater: false } });
    await page.waitFor(`!(${inTheater}) && !document.documentElement.hasAttribute('ytk-in-theater')`, { timeout: 8000, label: 'po vypnutí mimo kino' });
    await patchSettings({ theater: { enabled: true, autoTheater: false } });
    return 'zapnutí → kino, vypnutí → běžné zobrazení, bez obnovení stránky';
  });

  await step('Režim kina: volba „Vypnout ambientní záři“ skryje #cinematics', async () => {
    await patchSettings({ theater: { noAmbient: false } });
    if (!(await page.evaluate(`document.documentElement.hasAttribute('ytk-in-theater')`))) {
      await page.evaluate(`document.querySelector('#movie_player .ytp-size-button').click(), true`);
      await page.waitFor(`document.documentElement.hasAttribute('ytk-in-theater')`, { timeout: 8000 });
    }
    const visible = `(() => { const e = document.querySelector('#cinematics'); return !!e && getComputedStyle(e).display !== 'none'; })()`;
    const before = await page.evaluate(visible);
    await patchSettings({ theater: { noAmbient: true } });
    await page.waitFor(`!(${visible}) && document.documentElement.hasAttribute('ytk-no-ambient')`, { timeout: 5000, label: 'záře skrytá' });
    await patchSettings({ theater: { noAmbient: false } });
    await page.waitFor(`!document.documentElement.hasAttribute('ytk-no-ambient')`, { timeout: 5000 });
    return before ? 'záře byla vidět, po zapnutí volby skrytá' : 'záře nebyla aktivní, volba ji skrývá';
  });

  await step('Výchozí rychlost: 1,5× u videa, hudba normální rychlostí', async () => {
    // Rick Astley je v kategorii „Music“ → se zapnutou výjimkou pro hudbu zůstane 1×.
    await patchSettings({ playback: { enabled: true, speed: '1.5', skipMusic: true } });
    await sleep(2500);
    const musicRate = await page.evaluate(`document.querySelector('#movie_player video').playbackRate`);
    assert(musicRate === 1, `hudba zrychlená na ${musicRate}`);
    await patchSettings({ playback: { skipMusic: false } });
    await page.waitFor(`document.querySelector('#movie_player video').playbackRate === 1.5`, { timeout: 8000, label: 'rychlost 1,5×' });
    // Vypnutí modulu vrátí právě hrající video na 1× (bez obnovení).
    await patchSettings({ playback: { enabled: false } });
    await page.waitFor(`document.querySelector('#movie_player video').playbackRate === 1`, { timeout: 5000, label: 'po vypnutí zpět 1×' });
    await patchSettings({ playback: { speed: '1.25', skipMusic: true } });
    return 'hudba 1×, po vypnutí výjimky 1,5×, po vypnutí modulu zpět 1×';
  });

  await step('Klávesové zkratky: přepnutí kina a připnutí horní lišty', async () => {
    const commands = await ext.evaluate(`chrome.commands.getAll().then((list) => list.map((c) => c.name + ':' + (c.shortcut || '-')))`);
    assert(commands.includes('toggle-theater:-') && commands.includes('toggle-masthead:-'), `příkazy: ${commands}`);
    const send = (command) =>
      ext.evaluate(`(async () => {
        for (const tab of await chrome.tabs.query({})) {
          if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'ytk:command', command: ${JSON.stringify(command)} }, { frameId: 0 }).catch(() => {});
        }
        return true;
      })()`);
    const inTheater = `document.querySelector('ytd-watch-flexy').hasAttribute('theater')`;
    const before = await page.evaluate(inTheater);
    await send('toggle-theater');
    await page.waitFor(`${inTheater} === ${!before}`, { timeout: 5000, label: 'kino přepnuté zkratkou' });
    if (!(await page.evaluate(inTheater))) {
      await send('toggle-theater');
      await page.waitFor(inTheater, { timeout: 5000 });
    }
    await page.waitFor(`document.documentElement.hasAttribute('ytk-in-theater')`, { timeout: 5000 });
    await send('toggle-masthead');
    await page.waitFor(`document.documentElement.hasAttribute('ytk-masthead-visible')`, { timeout: 3000, label: 'lišta připnutá' });
    await sleep(1500); // připnutá lišta se sama neskryje
    assert(await page.evaluate(`document.documentElement.hasAttribute('ytk-masthead-visible')`), 'připnutá lišta se skryla');
    await send('toggle-masthead');
    await page.waitFor(`!document.documentElement.hasAttribute('ytk-masthead-visible')`, { timeout: 3000, label: 'lišta zase skrytá' });
    return 'zkratky bez výchozích kláves (volitelné), kino i lišta fungují';
  });

  await step('SponsorBlock: bez oprávnění nic nestahuje, se segmentem přeskočí a ukáže oznámení', async () => {
    await patchSettings({ sponsorBlock: { enabled: true, categories: ['sponsor'], notify: true } });
    const noPermission = await ext.evaluate(`chrome.runtime.sendMessage({ type: 'sb:get', videoId: 'kJQP7kiw5Fk' })`);
    assert(noPermission?.reason === 'no-permission', `bez oprávnění: ${JSON.stringify(noPermission)}`);
    const notice = await ext.waitFor(`!document.getElementById('sb-permission').hidden`, { timeout: 5000, label: 'upozornění na chybějící oprávnění' });
    // Segment do cache doplňku (stejně jako by ho uložil service worker), oprávnění tak není potřeba.
    const videoId = await page.evaluate(`new URL(location.href).searchParams.get('v')`);
    await ext.evaluate(`chrome.storage.session.set({ ['sb:v:' + ${JSON.stringify(videoId)}]: { t: Date.now(), d: [{ start: 30, end: 45, category: 'sponsor', uuid: 'e2e' }] } }).then(() => true)`);
    await page.send('Page.reload');
    await sleep(1500);
    await playerReady(videoId);
    await sleep(1000);
    await page.evaluate(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 31; v.play().catch(() => {}); return true; })()`);
    await page.waitFor(`document.querySelector('#movie_player video').currentTime >= 44.5`, { timeout: 8000, label: 'přeskočeno na konec segmentu' });
    const toast = await page.waitFor(`document.querySelector('.ytk-sb-toast')?.textContent`, { timeout: 3000, label: 'oznámení' });
    // Návrat do segmentu ručně: podruhé se už nepřeskakuje.
    await page.evaluate(`(document.querySelector('#movie_player video').currentTime = 32, true)`);
    await sleep(1500);
    const time = await page.evaluate(`document.querySelector('#movie_player video').currentTime`);
    assert(time < 44, `ručně vrácený segment se znovu přeskočil (${time})`);
    await patchSettings({ sponsorBlock: { enabled: false } });
    return `„${toast}“, upozornění na oprávnění: ${Boolean(notice)}`;
  });

  // ---- 4. SPA navigace + automatické kino ----
  await step('SPA navigace na další video: dislajky, kvalita, auto-kino', async () => {
    await page.evaluate(`document.querySelector('#movie_player .ytp-size-button').click(), true`); // vypnout kino
    await page.waitFor(`!document.querySelector('ytd-watch-flexy').hasAttribute('theater')`, { timeout: 5000 });
    await patchSettings({ theater: { autoTheater: true } });
    const href = await page.waitFor(
      `[...document.querySelectorAll('#secondary a[href^="/watch?v="]')].map(a => a.getAttribute('href')).find(h => !h.includes(${JSON.stringify(VIDEO)}))`,
      { timeout: 15000, label: 'odkaz na doporučené video' },
    );
    const nextId = new URL(href, 'https://www.youtube.com').searchParams.get('v');
    await page.evaluate(`document.querySelector('#secondary a[href^=${JSON.stringify(href.split('&')[0])}]').click(), true`);
    await page.waitFor(`new URL(location.href).searchParams.get('v') === ${JSON.stringify(nextId)}`, { timeout: 10000 });
    await playerReady(nextId);
    await page.waitFor(`document.querySelector('ytd-watch-flexy').hasAttribute('theater')`, { timeout: 10000, label: 'auto-kino' });
    const expected = formatCs(await expectedDislikes(nextId));
    await page.waitFor(
      `(document.querySelector('.ytk-dislike-text')?.textContent || '').replaceAll(String.fromCharCode(160), ' ') === ${JSON.stringify(expected)}`,
      { timeout: 15000, label: `dislajky ${expected}` },
    );
    const count = await page.evaluate(`document.querySelectorAll('.ytk-dislike-text').length`);
    assert(count === 1, `počet vložených textů: ${count}`);
    await patchSettings({ theater: { autoTheater: false } });
    return `video ${nextId}, dislajky „${expected}“`;
  });

  // ---- 5. Kodeky ----
  await step('Kodeky: vypnutí AV1 → popup hlásí nutnost obnovení', async () => {
    await patchSettings({ codecs: { enabled: true, disabled: ['av1'] } });
    await page.waitFor(`(localStorage.getItem('ytk-codecs') || '').includes('av1')`, { timeout: 5000 });
    await sleep(300);
    const s = await status();
    assert(s?.reloadNeeded === true, `reloadNeeded = ${s?.reloadNeeded}`);
  });

  await step('Kodeky: po obnovení je AV1 nepodporované ve všech třech API a nehraje', async () => {
    await page.send('Page.reload');
    await sleep(1500);
    await playerReady(await page.waitFor(`new URL(location.href).searchParams.get('v')`));
    const check = await page.evaluate(`(async () => {
      const av1 = 'video/mp4; codecs="av01.0.08M.08"', vp9 = 'video/webm; codecs="vp09.00.51.08"';
      const cfg = (t) => ({ type: 'media-source', video: { contentType: t, width: 1920, height: 1080, bitrate: 5e6, framerate: 30 } });
      return {
        mseAv1: MediaSource.isTypeSupported(av1), mseVp9: MediaSource.isTypeSupported(vp9),
        cptAv1: document.createElement('video').canPlayType(av1),
        mcAv1: (await navigator.mediaCapabilities.decodingInfo(cfg(av1))).supported,
        mcVp9: (await navigator.mediaCapabilities.decodingInfo(cfg(vp9))).supported,
        nerd: document.querySelector('#movie_player').getStatsForNerds().codecs,
      };
    })()`);
    assert(check.mseAv1 === false && check.cptAv1 === '' && check.mcAv1 === false, `AV1 stále hlášeno: ${JSON.stringify(check)}`);
    assert(check.mseVp9 === true && check.mcVp9 === true, `VP9 omylem blokováno: ${JSON.stringify(check)}`);
    await sleep(2000);
    const nerd = await page.evaluate(`document.querySelector('#movie_player').getStatsForNerds().codecs`);
    assert(!/av01/.test(nerd), `přehrává se AV1: ${nerd}`);
    const s = await status();
    assert(s?.reloadNeeded === false, 'po obnovení stále hlásí nutnost obnovení');
    return `hraje ${nerd}`;
  });

  await step('Omezit na 30 fps: streamy s framerate>30 jsou nepodporované', async () => {
    await patchSettings({ quality: { fps: 'cap30' } });
    await page.send('Page.reload');
    await sleep(1500);
    await playerReady(await page.waitFor(`new URL(location.href).searchParams.get('v')`));
    const r = await page.evaluate(`({ f60: MediaSource.isTypeSupported('video/webm; codecs="vp9"; width=1920; height=1080; framerate=60'),
      f30: MediaSource.isTypeSupported('video/webm; codecs="vp9"; width=1920; height=1080; framerate=30') })`);
    assert(r.f60 === false && r.f30 === true, JSON.stringify(r));
  });

  await patchSettings({ codecs: { enabled: false, disabled: [] }, quality: { fps: 'none' } });

  // ---- 6. Výpadek RYD API ----
  await step('Výpadek RYD API: zobrazí „–“ a nic se nerozbije', async () => {
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    const sw = targets.find((t) => t.type === 'service_worker' && t.url.includes(extensionId));
    if (!sw) throw skip('service worker není aktivní, nelze zablokovat síť');
    const worker = await attach(sw.targetId);
    await worker.send('Network.enable');
    await worker.send('Network.setBlockedURLs', { urls: ['*returnyoutubedislikeapi.com*'] });
    await ext.evaluate(`chrome.storage.session.clear().then(() => true)`);
    await page.send('Page.reload');
    await sleep(1500);
    const text = await page.waitFor(`document.querySelector('.ytk-dislike-text')?.textContent`, { timeout: 15000 });
    await worker.send('Network.setBlockedURLs', { urls: [] });
    assert(text === '–', `zobrazeno „${text}“`);
    const player = await page.evaluate(`!!document.querySelector('#movie_player video')`);
    assert(player, 'přehrávač chybí');
    return '„–“';
  });

  await step('Cache RYD v chrome.storage.session', async () => {
    await page.send('Page.reload');
    await sleep(1500);
    await page.waitFor(`/\\d/.test(document.querySelector('.ytk-dislike-text')?.textContent || '')`, { timeout: 15000 });
    const keys = await ext.evaluate(`chrome.storage.session.get(null).then(all => Object.keys(all).filter(k => k.startsWith('ryd:v:')))`);
    assert(keys.length >= 1, 'cache je prázdná');
    return `${keys.length} záznam(y)`;
  });

  // ---- 7. Embed ----
  await step('Embed (youtube-nocookie.com v iframe): zvláštní kvalita 720p', async () => {
    await patchSettings({ quality: { embedPreferred: '720' } });
    // Embed musí být vložený do stránky (YouTube jinak odmítne přehrát). Stránku example.com podvrhneme
    // lokálně přes Fetch.fulfillRequest – na example.com se nic neodešle.
    const html = `<!doctype html><title>embed test</title><iframe width="960" height="540" allow="autoplay"
      src="https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1&mute=1"></iframe>`;
    await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://example.com/*', requestStage: 'Request' }] });
    const off = cdp.on((message) => {
      if (message.sessionId !== page.sessionId || message.method !== 'Fetch.requestPaused') return;
      page.send('Fetch.fulfillRequest', {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(html).toString('base64'),
      });
    });
    try {
      await page.send('Page.navigate', { url: 'https://example.com/embed-test' });
      const embedStatus = async () =>
        ext.evaluate(`(async () => {
          for (const tab of await chrome.tabs.query({})) {
            try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'ytk:getStatus' }); if (r && r.ok && r.pageType === 'embed') return r; } catch {}
          }
          return null;
        })()`);
      const deadline = Date.now() + 30000;
      let last = null;
      while (Date.now() < deadline) {
        last = await embedStatus();
        if (last?.quality?.startsWith('720p')) break;
        await sleep(1000);
      }
      assert(last?.quality?.startsWith('720p'), `stav embedu: ${JSON.stringify(last)}`);
      return `${last.quality}, ${last.width}×${last.height}`;
    } finally {
      off();
      await page.send('Fetch.disable');
      await patchSettings({ quality: { embedPreferred: null } });
    }
  });

  // ---- 8. Shorts ----
  await step('Shorts: dislajky místo popisku, bez režimu kina', async () => {
    await goto('https://www.youtube.com/shorts');
    const id = await page
      .waitFor(`(location.pathname.match(/^\\/shorts\\/([\\w-]{11})/) || [])[1]`, { timeout: 20000 })
      .catch(() => null);
    if (!id) throw skip('feed Shorts se v čistém profilu nenačetl');
    const expected = formatCs(await expectedDislikes(id));
    const text = await page
      .waitFor(
        `(() => { const l = document.querySelector('.ytk-shorts-dislike .ytk-dislike-text, [data-ytk-orig]'); return l && l.textContent.replaceAll(String.fromCharCode(160), ' '); })()`,
        { timeout: 15000, label: 'popisek s počtem' },
      )
      .catch(async (error) => {
        const structure = await page.evaluate(`(() => {
          const strip = (el) => el ? el.outerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g, '<svg/>').replace(/<!--[\\s\\S]*?-->/g, '').replace(/\\s(style|d|jsname)="[^"]*"/g, '').slice(0, 2500) : null;
          const active = document.querySelector('ytd-reel-video-renderer[is-active]');
          const hosts = [...document.querySelectorAll('dislike-button-view-model, #dislike-button')];
          const visible = hosts.filter((h) => h.offsetWidth > 0);
          const chain = (el) => { const c = []; while (el && c.length < 10) { c.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.hasAttribute && el.hasAttribute('is-active') ? '[is-active]' : '')); el = el.parentElement; } return c.join(' < '); };
          const byLabel = [...document.querySelectorAll('[aria-label]')].filter((e) => /nelíbí|dislike/i.test(e.getAttribute('aria-label')) && e.offsetWidth > 0);
          const likes = [...document.querySelectorAll('like-button-view-model')].filter((e) => e.offsetWidth > 0);
          const target = visible[0] || hosts[0] || byLabel[0] || likes[0];
          let host = target;
          for (let i = 0; i < 1 && host && host.parentElement; i++) host = host.parentElement;
          return { url: location.href, active: !!active, hosts: hosts.length, visible: visible.length, byLabel: byLabel.length,
            labels: byLabel.slice(0, 3).map((e) => e.tagName + ' ' + e.getAttribute('aria-label')),
            chain: chain(target), html: strip(host) };
        })()`);
        const state = await diagnose('shorts');
        throw new Error(`${error.message}\n    struktura: ${JSON.stringify(structure)}\n    stav: ${JSON.stringify(state)}`, {
          cause: error,
        });
      });
    const theater = await page.evaluate(`document.documentElement.hasAttribute('ytk-in-theater')`);
    assert(!theater, 'režim kina aktivní na Shorts');
    assert(text === expected, `zobrazeno „${text}“, API „${expected}“`);
    await diagnose('shorts-ok');
    // Posun na další Short (klávesa šipka dolů) → nové ID a nový počet.
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    const nextId = await page
      .waitFor(`(() => { const m = location.pathname.match(/^\\/shorts\\/([\\w-]{11})/); return m && m[1] !== ${JSON.stringify(id)} && m[1]; })()`, { timeout: 10000 })
      .catch(() => null);
    if (!nextId) return `short ${id}: „${text}“ (posun na další Short se nepodařil)`;
    const nextExpected = formatCs(await expectedDislikes(nextId));
    await page.waitFor(
      `(() => { const all = document.querySelectorAll('.ytk-shorts-dislike'); const l = document.querySelector('.ytk-shorts-dislike .ytk-dislike-text');
        return all.length === 1 && l && l.textContent.replaceAll(String.fromCharCode(160), ' ') === ${JSON.stringify(nextExpected)}; })()`,
      { timeout: 15000, label: `další short ${nextId}: ${nextExpected}` },
    );
    return `short ${id}: „${text}“, po posunu ${nextId}: „${nextExpected}“`;
  });

  // ---- 9. Skrytí Shorts ----
  let sampleShort = null;
  await step('Skrýt Shorts: police, videa, menu a filtr zmizí a po vypnutí se vrátí bez obnovení', async () => {
    await goto('https://www.youtube.com/results?search_query=kocka');
    const visibleCount = `[...document.querySelectorAll('ytm-shorts-lockup-view-model, a[href^="/shorts/"]')].filter((e) => e.getClientRects().length > 0).length`;
    const guideVisible = `[...document.querySelectorAll('ytd-guide-entry-renderer')].some((g) => g.querySelector('a[title="Shorts"]') && g.getClientRects().length > 0)`;
    const chipVisible = `[...document.querySelectorAll('yt-chip-cloud-chip-renderer, chip-view-model, chip-shape')].some((c) => c.textContent.trim() === 'Shorts' && c.getClientRects().length > 0)`;
    const before = await page.waitFor(visibleCount, { timeout: 20000, label: 'Shorts ve výsledcích' });
    sampleShort = await page.evaluate(`(() => {
      for (const a of document.querySelectorAll('a[href*="/shorts/"]')) {
        const match = (a.getAttribute('href') || '').match(/\\/shorts\\/([\\w-]{11})/);
        if (match) return match[1];
      }
      return null;
    })()`);
    await patchSettings({ hideShorts: { enabled: true } });
    await page.waitFor(`${visibleCount} === 0`, { timeout: 5000, label: 'Shorts skryté' }).catch(async (error) => {
      const info = await page.evaluate(`(() => {
        const lockup = document.querySelector('ytm-shorts-lockup-view-model');
        const style = document.getElementById('ytk-hide-shorts-style');
        const visible = [...document.querySelectorAll('ytm-shorts-lockup-view-model, a[href*="/shorts/"]')].filter((e) => e.getClientRects().length > 0);
        return { attr: document.documentElement.hasAttribute('ytk-hide-shorts'), style: !!style, styleParent: style && style.parentElement && style.parentElement.tagName,
          rules: style && style.sheet && style.sheet.cssRules.length, lockupDisplay: lockup && getComputedStyle(lockup).display,
          hrefs: [...document.querySelectorAll('a[href*="/shorts"]')].slice(0, 3).map((a) => a.getAttribute('href')),
          visible: visible.slice(0, 3).map((e) => { const c = []; let n = e; while (n && c.length < 8) { c.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.getAttribute('title') ? '[title=' + n.getAttribute('title') + ']' : '')); n = n.parentElement; } return (e.getAttribute('href') || '') + ' :: ' + c.join(' < '); }) };
      })()`);
      throw new Error(`${error.message}\n    diagnostika: ${JSON.stringify(info)}`, { cause: error });
    });
    const guide = await page.evaluate(guideVisible);
    await page.waitFor(`!(${chipVisible})`, { timeout: 5000, label: 'filtr Shorts skrytý' });
    const regular = await page.evaluate(`[...document.querySelectorAll('ytd-video-renderer')].filter((e) => e.getClientRects().length > 0).length`);
    await diagnose('shorts-hidden');
    assert(!guide, 'položka Shorts v menu je vidět');
    assert(regular > 0, 'skryla se i běžná videa');
    await patchSettings({ hideShorts: { enabled: false } });
    const after = await page.waitFor(visibleCount, { timeout: 5000, label: 'Shorts zpět' });
    return `před: ${before} prvků Shorts, skryto vše, běžných videí ${regular}, po vypnutí ${after}`;
  });

  await step('Skrýt Shorts: odkaz na Short se otevře v běžném přehrávači', async () => {
    if (!sampleShort) throw skip('nenašel jsem ID Shortu');
    await patchSettings({ hideShorts: { enabled: true, redirect: true } });
    try {
      await goto(`https://www.youtube.com/shorts/${sampleShort}`);
      await page.waitFor(`location.pathname === '/watch' && new URL(location.href).searchParams.get('v') === ${JSON.stringify(sampleShort)}`, {
        timeout: 15000,
        label: `/watch?v=${sampleShort}`,
      });
      await playerReady(sampleShort);
      return `/shorts/${sampleShort} → /watch?v=${sampleShort}`;
    } finally {
      await patchSettings({ hideShorts: { enabled: false, redirect: false } });
    }
  });

  // ---- 10. Rozptýlení, smyčka, snímek, chat ----
  await goto(`https://www.youtube.com/watch?v=${VIDEO}`);
  await playerReady(VIDEO);
  const sendCommand = (command) =>
    ext.evaluate(`(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'ytk:command', command: ${JSON.stringify(command)} }, { frameId: 0 }).catch(() => {});
      }
      return true;
    })()`);

  await step('Skrýt rozptýlení: doporučená, komentáře, závěrečné obrazovky a karty', async () => {
    const shown = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].some((e) => e.getClientRects().length > 0)`;
    await page.waitFor(shown('ytd-watch-flexy #related'), { timeout: 15000, label: 'doporučená videa vidět' });
    await page.evaluate(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = v.duration - 12; v.play().catch(() => {}); return true; })()`);
    await page.waitFor(shown('.ytp-ce-element'), { timeout: 15000, label: 'závěrečné karty vidět' });
    await patchSettings({ distractions: { related: true, comments: true, endScreens: true, cards: true } });
    await page.waitFor(`!(${shown('ytd-watch-flexy #related')}) && !(${shown('ytd-watch-flexy #comments')}) && !(${shown('.ytp-ce-element')}) && !(${shown('.iv-branding')})`, {
      timeout: 5000,
      label: 'rozptýlení skrytá',
    });
    await patchSettings({ distractions: { related: false, comments: false, endScreens: false, cards: false } });
    await page.waitFor(shown('ytd-watch-flexy #related'), { timeout: 5000, label: 'po vypnutí zpět' });
    await page.evaluate(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 5; return true; })()`);
    return 'skryto bez obnovení a po vypnutí zpět';
  });

  await step('Smyčka: úsek A–B a celé video (zkratky)', async () => {
    await playerReady(VIDEO);
    const time = `document.querySelector('#movie_player video').currentTime`;
    await page.evaluate(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 20; v.play().catch(() => {}); return true; })()`);
    await sleep(500);
    await sendCommand('loop-a');
    await page.evaluate(`(document.querySelector('#movie_player video').currentTime = 26, true)`);
    await sleep(300);
    await sendCommand('loop-b');
    const toast = await page.waitFor(`document.querySelector('.ytk-player-toast')?.textContent`, { timeout: 3000, label: 'oznámení smyčky' });
    // Po dosažení B (26 s) skok zpět na A (20 s).
    await page.waitFor(`${time} >= 25`, { timeout: 10000, label: 'přehrávání k B' });
    await page.waitFor(`${time} < 23`, { timeout: 5000, label: 'skok zpět na A' });
    await sendCommand('loop-clear');
    await sleep(300);
    // Celé video: na konci zpět na začátek místo dalšího videa.
    await sendCommand('loop-toggle');
    await page.evaluate(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = v.duration - 3; v.play().catch(() => {}); return true; })()`);
    await page.waitFor(`${time} < 5 && new URL(location.href).searchParams.get('v') === ${JSON.stringify(VIDEO)}`, { timeout: 15000, label: 'celé video znovu od začátku' });
    await sendCommand('loop-toggle');
    return `„${toast}“, úsek i celé video se opakují`;
  });

  await step('Snímek obrazovky videa: zkratka stáhne PNG v plném rozlišení', async () => {
    await playerReady(await page.evaluate(`new URL(location.href).searchParams.get('v')`));
    const dir = mkdtempSync(join(tmpdir(), 'ytk-shot-'));
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true });
    await sendCommand('screenshot');
    const deadline = Date.now() + 15000;
    let item;
    while (Date.now() < deadline) {
      item = downloads.find((d) => d.state === 'completed');
      if (item) break;
      await sleep(250);
    }
    const toast = await page.evaluate(`document.querySelector('.ytk-player-toast')?.textContent || ''`);
    rmSync(dir, { recursive: true, force: true });
    assert(item, `stahování nedokončeno: ${JSON.stringify(downloads)}`);
    assert(item.name.endsWith('.png') && item.bytes > 10000, `soubor: ${item.name}, ${item.bytes} B`);
    return `${item.name} (${Math.round(item.bytes / 1024)} kB), „${toast}“`;
  });

  await step('Živý přenos: chat se automaticky skryje', async () => {
    await patchSettings({ theater: { hideLiveChat: true } });
    await goto('https://www.youtube.com/@LofiGirl/live');
    const live = await page
      .waitFor(`!!document.querySelector('ytd-live-chat-frame')`, { timeout: 20000 })
      .catch(() => false);
    if (!live) throw skip('živý přenos s chatem se nenačetl');
    await page.waitFor(`!document.querySelector('ytd-watch-flexy').hasAttribute('live-chat-present-and-expanded')`, {
      timeout: 25000,
      label: 'chat sbalený',
    }).catch(async (error) => {
      const info = await page.evaluate(`({ url: location.href, attrs: [...document.querySelector('ytd-watch-flexy').attributes].map((a) => a.name).filter((n) => /chat|live|theater/.test(n)), html: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('ytk')), btn: !!document.querySelector('ytd-live-chat-frame #show-hide-button button') })`);
      throw new Error(error.message + ' ' + JSON.stringify(info), { cause: error });
    });
    await patchSettings({ theater: { hideLiveChat: false } });
    return 'chat sbalený nativním tlačítkem YouTube';
  });

  // ---- 11. Chyby ----
  await step('Konzole: žádné chyby z rozšíření', async () => {
    assert(errors.length === 0, errors.slice(0, 5).join(' | '));
  });
} catch (error) {
  record('Neočekávaná chyba testu', false, error.message);
} finally {
  await cdp.send('Browser.close').catch(() => child.kill());
  await sleep(1500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    // dočasný profil uklidí systém
  }
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n${results.length - failed - skipped} OK, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed > 0 ? 1 : 0);
}
