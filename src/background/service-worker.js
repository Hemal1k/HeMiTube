/**
 * Service worker: načítá počty z Return YouTube Dislike API (host_permissions platí jen tady,
 * content script by spoléhal na CORS) a cachuje je v chrome.storage.session (TTL ~10 min).
 * Při 429 (rate limit 100/min) se na minutu odmlčí. Nic se neodesílá kromě ID videa.
 *
 * Dále: segmenty SponsorBlocku (jen s udělením volitelného oprávnění k sponsor.ajay.app; dotaz podle
 * prefixu SHA-256 hashe ID, cache 30 min) a klávesové zkratky (chrome.commands → aktivní karta).
 */
import { SETTINGS_KEY, migrate } from '../shared/settings.js';
import { VIDEO_ID_RE } from '../shared/utils.js';
import { RYD_BACKOFF_MS, RYD_CACHE_TTL_MS, RYD_VOTES_URL, isCacheFresh, parseVotes } from '../shared/ryd.js';
import { SB_CACHE_TTL_MS, SB_ORIGIN, parseSegments, sbQueryUrl } from '../shared/sponsorblock.js';
import { WELCOME_PATH, isFirstInstall } from '../shared/welcome.js';

const BACKOFF_KEY = 'ryd:backoff';
const CACHE_PREFIX = 'ryd:v:';
const SB_CACHE_PREFIX = 'sb:v:';
const PRUNE_EVERY = 50;
let writesSincePrune = 0;

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    await chrome.storage.sync.set({ [SETTINGS_KEY]: migrate(stored[SETTINGS_KEY]) });
  } catch (error) {
    console.warn('HeMiTube: nastavení se při instalaci nepodařilo zapsat', error);
  }
  // Jen při první instalaci: ukázat, že dislajky načítá třetí strana, a nabídnout vypnutí.
  if (isFirstInstall(details)) {
    chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PATH) }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'ryd:get') {
    getVotes(message.videoId).then(sendResponse, () => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }
  if (message?.type === 'sb:get') {
    getSegments(message.videoId).then(sendResponse, () => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }
  return false;
});

// Klávesové zkratky nemají výchozí klávesy: uživatel si je nastaví v chrome://extensions/shortcuts (edge://, brave://…).
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'ytk:command', command }, { frameId: 0 }).catch(() => {});
});


async function sha256Prefix(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 2)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function getSegments(videoId) {
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) return { ok: false, reason: 'bad-id' };
  const key = SB_CACHE_PREFIX + videoId;
  const now = Date.now();
  const stored = await chrome.storage.session.get(key);
  if (isCacheFresh(stored[key], now, SB_CACHE_TTL_MS)) return { ok: true, segments: stored[key].d, cached: true };
  if (!(await chrome.permissions.contains({ origins: [SB_ORIGIN] }))) return { ok: false, reason: 'no-permission' };

  let response;
  try {
    response = await fetch(sbQueryUrl(await sha256Prefix(videoId)), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  let segments = []; // 404 = pro tento prefix nic není
  if (response.status !== 404) {
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };
    try {
      segments = parseSegments(await response.json(), videoId);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
  await chrome.storage.session.set({ [key]: { t: now, d: segments } });
  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    pruneCache(now).catch(() => {});
  }
  return { ok: true, segments };
}

async function getVotes(videoId) {
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) return { ok: false, reason: 'bad-id' };
  const key = CACHE_PREFIX + videoId;
  const now = Date.now();
  const stored = await chrome.storage.session.get([key, BACKOFF_KEY]);
  if (isCacheFresh(stored[key], now)) return { ok: true, ...stored[key].d, cached: true };
  if (typeof stored[BACKOFF_KEY] === 'number' && now < stored[BACKOFF_KEY]) return { ok: false, reason: 'rate-limited' };

  let response;
  try {
    response = await fetch(RYD_VOTES_URL + encodeURIComponent(videoId), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (response.status === 429) {
    await chrome.storage.session.set({ [BACKOFF_KEY]: now + RYD_BACKOFF_MS });
    return { ok: false, reason: 'rate-limited' };
  }
  if (!response.ok) return { ok: false, reason: `http-${response.status}` };

  let votes;
  try {
    votes = parseVotes(await response.json());
  } catch {
    votes = null;
  }
  if (!votes) return { ok: false, reason: 'invalid' };

  await chrome.storage.session.set({ [key]: { t: now, d: votes } });
  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    pruneCache(now).catch(() => {});
  }
  return { ok: true, ...votes };
}

/** Smaže prošlé záznamy obou cache (počty RYD i segmenty SponsorBlocku). */
async function pruneCache(now) {
  const all = await chrome.storage.session.get(null);
  const expired = Object.keys(all).filter(
    (key) =>
      (key.startsWith(CACHE_PREFIX) && !isCacheFresh(all[key], now, RYD_CACHE_TTL_MS)) ||
      (key.startsWith(SB_CACHE_PREFIX) && !isCacheFresh(all[key], now, SB_CACHE_TTL_MS)),
  );
  if (expired.length > 0) await chrome.storage.session.remove(expired);
}

// Počítadlo zápisů je v paměti workeru a po uspání se vynuluje → čistit i při každém startu workeru.
pruneCache(Date.now()).catch(() => {});
