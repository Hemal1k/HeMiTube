/**
 * Vstupní bod izolovaného světa (document_start, all_frames).
 * Most se zakládá synchronně hned na začátku, aby nezmeškal zprávu `hello` z MAIN worldu.
 */
import { createBridge } from './bridge.js';
import { initTheater } from './theater.js';
import { initDislikes } from './dislikes.js';
import { initQuality } from './quality.js';
import { initHideShorts } from './shorts-hide.js';
import { initPlayback } from './playback.js';
import { initSponsorBlock } from './sponsorblock.js';
import { initScreenshot } from './screenshot.js';
import { initDistractions } from './distractions.js';
import { initLoop } from './loop.js';
import { loadSettings, watchSettings } from '../shared/storage.js';
import { createNavigationWatcher } from '../shared/navigation.js';
import { codecsOf } from '../shared/codec-logic.js';
import { findActiveVideo, getPageInfo } from '../shared/utils.js';

/** Odpověď pro popup. Odpovídá jen rámec, ve kterém je video, ostatní mlčí. */
function registerStatusResponder(bridge) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'ytk:getStatus') return false;
    const video = findActiveVideo();
    if (!video) return false;
    (async () => {
      const info = await bridge.call('getPlayerInfo', {}, 1500).catch(() => null);
      const codec = bridge.getCodecState();
      sendResponse({
        ok: true,
        pageType: getPageInfo(location.href).pageType,
        width: video.videoWidth,
        height: video.videoHeight,
        fps: Number.isInteger(info?.fps) && info.fps > 0 && info.fps <= 240 ? info.fps : null,
        quality: typeof info?.qualityLabel === 'string' && /^[\w .+-]{1,40}$/.test(info.qualityLabel) ? info.qualityLabel : null,
        videoCodec: codecsOf(codec.video)[0] ?? null,
        audioCodec: codecsOf(codec.audio)[0] ?? null,
        videoMime: codec.video,
        audioMime: codec.audio,
        reloadNeeded: bridge.isReloadNeeded(),
      });
    })();
    return true;
  });
}

/** Doplněk pracuje jen v horním rámci a v přehrávači vloženém na jiném webu (/embed/). */
const isRelevantFrame = () => window.top === window || location.pathname.startsWith('/embed/');

async function main() {
  if (!isRelevantFrame()) return;
  const bridge = createBridge();
  let settings = await loadSettings();
  bridge.onSettings(settings);

  const ctx = { bridge, getSettings: () => settings, isTop: window.top === window };
  const modules = [
    initTheater(ctx),
    initDislikes(ctx),
    initQuality(ctx),
    initHideShorts(ctx),
    initPlayback(ctx),
    initSponsorBlock(ctx),
    initScreenshot(ctx),
    initDistractions(ctx),
    initLoop(ctx),
  ].filter(Boolean);

  // Klávesové zkratky: service worker je pošle hornímu rámci aktivní karty.
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'ytk:command' || typeof message.command !== 'string') return false;
    for (const module of modules) module.onCommand?.(message.command);
    return false;
  });

  watchSettings((next) => {
    settings = next;
    bridge.onSettings(next);
    for (const module of modules) module.onSettings?.(next);
  });
  registerStatusResponder(bridge);
  createNavigationWatcher((info) => {
    for (const module of modules) module.onNavigate?.(info);
  });
}

main();
