/**
 * Práce s API přehrávače YouTube (MAIN world: metody jsou na prvku #movie_player,
 * které z izolovaného světa nejsou vidět).
 *
 * Použité metody (zdroj: avi12/youtube-auto-hd; getAvailableQualityLevels, getPlaybackQuality,
 * getVideoData, getPlayerResponse jsou neoficiální [P]): getAvailableQualityData,
 * getAvailableQualityLevels, setPlaybackQualityRange, getPlaybackQuality, getVideoData, getPlayerResponse.
 */
import { SELECTORS, YT } from '../shared/selectors.js';
import { QUALITY_OPTIONS, SPEED_OPTIONS } from '../shared/settings.js';
import { normalizeQualityData, normalizeQualityLevels, parseLabel, pickQuality } from '../shared/quality-logic.js';
import { isVisible } from '../shared/utils.js';

const safe = (fn) => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

export function getPlayer() {
  let fallback = null;
  for (const selector of SELECTORS.player) {
    for (const element of document.querySelectorAll(selector)) {
      if (typeof element.setPlaybackQualityRange !== 'function') continue;
      if (isVisible(element)) return element;
      fallback ??= element;
    }
  }
  return fallback;
}

function availableQualities(player) {
  const fromData = normalizeQualityData(safe(() => player.getAvailableQualityData()));
  if (fromData.length > 0) return fromData;
  return normalizeQualityLevels(safe(() => player.getAvailableQualityLevels()));
}

/** Příkaz z izolovaného světa: nastav kvalitu podle preferencí. Data se validují. */
export function applyQuality(data) {
  const preferred = QUALITY_OPTIONS.includes(data.preferred) ? data.preferred : 'screen';

  const player = getPlayer();
  if (!player) return { ok: false, reason: 'no-player' };
  if (player.classList.contains(YT.adShowingClass)) return { ok: false, reason: 'ad' };

  const available = availableQualities(player);
  if (available.length === 0) return { ok: false, reason: 'no-levels' };

  // Fyzické pixely obrazovky (např. 1920×1080 při 125 % = 864 × 1,25).
  const screenHeight = Math.round((window.screen?.height ?? 0) * (window.devicePixelRatio || 1));
  const choice = pickQuality(available, preferred, { fallback: 'higher', screenHeight });
  if (!choice) return { ok: false, reason: 'no-choice' };

  const before = safe(() => player.getPlaybackQuality()) ?? null;
  player.setPlaybackQualityRange(choice.quality, choice.quality);
  return { ok: true, target: choice.quality, targetHeight: choice.height, label: choice.label, before };
}

/**
 * Příkaz z izolovaného světa: výchozí rychlost přehrávání.
 * Živé přenosy se nikdy nezrychlují; volitelně ani hudba (kategorie „Music“ z playerResponse, ověřeno 2026-11).
 * Vrací done: true, když je o videu rozhodnuto (nastaveno nebo záměrně vynecháno).
 */
export function applyPlaybackRate(data) {
  const speed = SPEED_OPTIONS.includes(data.speed) ? Number(data.speed) : 1;
  const player = getPlayer();
  if (!player || typeof player.setPlaybackRate !== 'function') return { done: false, reason: 'no-player' };
  if (player.classList.contains(YT.adShowingClass)) return { done: false, reason: 'ad' };
  const response = safe(() => player.getPlayerResponse()) ?? {};
  const details = response.videoDetails ?? {};
  if (typeof data.videoId === 'string' && details.videoId !== data.videoId) return { done: false, reason: 'not-ready' };
  // Vynechané video (živý přenos, hudba): když ho modul dřív zrychlil, vrátit 1×.
  const skip = (reason) => {
    if (data.resetIfSkipped === true) player.setPlaybackRate(1);
    return { done: true, reason };
  };
  if (details.isLive || details.isLiveContent || safe(() => player.getVideoData().isLive)) return skip('live');
  const category = response.microformat?.playerMicroformatRenderer?.category;
  if (data.skipMusic && category === 'Music') return skip('music');
  player.setPlaybackRate(speed);
  return { done: true, reason: 'set', rate: safe(() => player.getPlaybackRate()) ?? speed };
}

/** Stav přehrávače pro popup a moduly (živý přenos, reklama, aktuální kvalita). */
export function getPlayerInfo() {
  const player = getPlayer();
  if (!player) return null;
  const quality = safe(() => player.getPlaybackQuality()) ?? null;
  const data = safe(() => player.getAvailableQualityData());
  const current = Array.isArray(data) ? data.find((item) => item?.quality === quality) : undefined;
  const label = typeof current?.qualityLabel === 'string' ? current.qualityLabel : null;
  const videoData = safe(() => player.getVideoData()) ?? {};
  const response = safe(() => player.getPlayerResponse()) ?? {};
  return {
    quality: typeof quality === 'string' ? quality : null,
    qualityLabel: label,
    fps: label ? (parseLabel(label).fps ?? 30) : null,
    isLive: Boolean(videoData.isLive ?? response?.videoDetails?.isLive),
    adShowing: player.classList.contains(YT.adShowingClass),
    videoId: typeof videoData.video_id === 'string' ? videoData.video_id : null,
  };
}
