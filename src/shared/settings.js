/** Schéma nastavení, výchozí hodnoty a migrace. Čisté funkce, testy: tests/settings.test.mjs. */
import { AUDIO_CODECS, VIDEO_CODECS } from './codec-logic.js';

export const SCHEMA_VERSION = 1;
export const SETTINGS_KEY = 'settings';

export const QUALITY_OPTIONS = Object.freeze(['screen', 'max', '4320', '2160', '1440', '1080', '720', '480', '360', '240', '144']);
export const REVEAL_OPTIONS = Object.freeze(['hover', 'scroll', 'both', 'never']);
export const FPS_OPTIONS = Object.freeze(['none', 'cap30']);
export const SPEED_OPTIONS = Object.freeze(['0.75', '1', '1.25', '1.5', '1.75', '2']);
/** Kategorie SponsorBlocku (https://wiki.sponsor.ajay.app/w/Segment_Categories), jen typ „skip“. */
export const SB_CATEGORIES = Object.freeze(['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic', 'filler']);

const DEFAULTS = {
  schemaVersion: SCHEMA_VERSION,
  theater: {
    enabled: true,
    fullWindow: true,
    hideMasthead: true,
    revealMasthead: 'hover',
    autoTheater: false,
    autoTheaterSkipLive: false,
    hideLiveChat: false,
    noAmbient: false,
  },
  dislikes: {
    enabled: true,
    ratioBar: false,
  },
  quality: {
    enabled: true,
    preferred: 'screen',
    fps: 'none',
    embedPreferred: null,
  },
  codecs: {
    enabled: false,
    order: ['av1', 'vp9', 'h264'],
    disabled: [],
    audioDisabled: [],
  },
  hideShorts: {
    enabled: false,
    redirect: false,
  },
  playback: {
    enabled: false,
    speed: '1.25',
    skipMusic: true,
  },
  sponsorBlock: {
    enabled: false,
    categories: ['sponsor'],
    notify: true,
  },
  distractions: {
    endScreens: false,
    cards: false,
    related: false,
    homeFeed: false,
    comments: false,
  },
};

export function defaultSettings() {
  return structuredClone(DEFAULTS);
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);

/** Kvalita: přijme i číslo (1080) nebo „1080p“; null jen pokud je povolené. */
function qualityValue(value, fallback, allowNull) {
  if (allowNull && (value === null || value === '' || value === undefined)) return null;
  if (typeof value === 'number') value = String(value);
  if (typeof value === 'string') value = value.trim().toLowerCase().replace(/p$/, '');
  return QUALITY_OPTIONS.includes(value) ? value : fallback;
}

function codecList(value, allowed) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((codec) => allowed.includes(codec)))];
}

/**
 * Převede libovolný vstup (uložená data, import JSON, starší verze) na platné nastavení
 * aktuální verze. Neznámé klíče zahodí, chybné hodnoty nahradí výchozími.
 */
export function migrate(raw) {
  const d = defaultSettings();
  if (!isObject(raw)) return d;

  // Verze 0 (bez schemaVersion) zatím nikdy nevyšla; místo pro budoucí převody: if (version < 2) {...}
  const theater = isObject(raw.theater) ? raw.theater : {};
  const dislikes = isObject(raw.dislikes) ? raw.dislikes : {};
  const quality = isObject(raw.quality) ? raw.quality : {};
  const codecs = isObject(raw.codecs) ? raw.codecs : {};
  const hideShorts = isObject(raw.hideShorts) ? raw.hideShorts : {};
  const playback = isObject(raw.playback) ? raw.playback : {};
  const sponsorBlock = isObject(raw.sponsorBlock) ? raw.sponsorBlock : {};
  const distractions = isObject(raw.distractions) ? raw.distractions : {};
  const speed = typeof playback.speed === 'number' ? String(playback.speed) : playback.speed;
  const categories = Array.isArray(sponsorBlock.categories)
    ? [...new Set(sponsorBlock.categories.filter((category) => SB_CATEGORIES.includes(category)))]
    : d.sponsorBlock.categories;

  const order = codecList(codecs.order, VIDEO_CODECS);
  for (const codec of d.codecs.order) if (!order.includes(codec)) order.push(codec);

  let disabled = codecList(codecs.disabled, VIDEO_CODECS);
  if (disabled.length >= VIDEO_CODECS.length) disabled = disabled.filter((codec) => codec !== order.at(-1));
  let audioDisabled = codecList(codecs.audioDisabled, AUDIO_CODECS);
  if (audioDisabled.length >= AUDIO_CODECS.length) audioDisabled = audioDisabled.filter((codec) => codec !== 'aac');

  return {
    schemaVersion: SCHEMA_VERSION,
    theater: {
      enabled: bool(theater.enabled, d.theater.enabled),
      fullWindow: bool(theater.fullWindow, d.theater.fullWindow),
      hideMasthead: bool(theater.hideMasthead, d.theater.hideMasthead),
      revealMasthead: oneOf(theater.revealMasthead, REVEAL_OPTIONS, d.theater.revealMasthead),
      autoTheater: bool(theater.autoTheater, d.theater.autoTheater),
      autoTheaterSkipLive: bool(theater.autoTheaterSkipLive, d.theater.autoTheaterSkipLive),
      hideLiveChat: bool(theater.hideLiveChat, d.theater.hideLiveChat),
      noAmbient: bool(theater.noAmbient, d.theater.noAmbient),
    },
    dislikes: {
      enabled: bool(dislikes.enabled, d.dislikes.enabled),
      ratioBar: bool(dislikes.ratioBar, d.dislikes.ratioBar),
    },
    quality: {
      enabled: bool(quality.enabled, d.quality.enabled),
      preferred: qualityValue(quality.preferred, d.quality.preferred, false),
      fps: oneOf(quality.fps, FPS_OPTIONS, d.quality.fps),
      embedPreferred: qualityValue(quality.embedPreferred, null, true),
    },
    codecs: {
      enabled: bool(codecs.enabled, d.codecs.enabled),
      order,
      disabled,
      audioDisabled,
    },
    hideShorts: {
      enabled: bool(hideShorts.enabled, d.hideShorts.enabled),
      redirect: bool(hideShorts.redirect, d.hideShorts.redirect),
    },
    playback: {
      enabled: bool(playback.enabled, d.playback.enabled),
      speed: oneOf(speed, SPEED_OPTIONS, d.playback.speed),
      skipMusic: bool(playback.skipMusic, d.playback.skipMusic),
    },
    sponsorBlock: {
      enabled: bool(sponsorBlock.enabled, d.sponsorBlock.enabled),
      categories,
      notify: bool(sponsorBlock.notify, d.sponsorBlock.notify),
    },
    distractions: Object.fromEntries(Object.keys(d.distractions).map((key) => [key, bool(distractions[key], false)])),
  };
}

/** Čtení/zápis hodnoty podle cesty „quality.preferred“ (pro options stránku). */
export function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

export function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((node, key) => node[key], object);
  target[last] = value;
  return object;
}
