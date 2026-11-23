/** Čisté funkce pro filtrování kodeků. Testy: tests/codecs.test.mjs. */

export const VIDEO_CODECS = Object.freeze(['av1', 'vp9', 'h264']);
export const AUDIO_CODECS = Object.freeze(['opus', 'aac']);
export const CODEC_STORAGE_KEY = 'ytk-codecs';

/** Prefix kódu kodeku v MIME (RFC 6381) → náš název. Pořadí je důležité (av01 před av…). */
const PREFIXES = Object.freeze([
  ['av01', 'av1'],
  ['av99', 'av1'],
  ['vp09', 'vp9'],
  ['vp9', 'vp9'],
  ['vp8', 'vp8'],
  ['avc1', 'h264'],
  ['avc3', 'h264'],
  ['mp4a', 'aac'],
  ['opus', 'opus'],
]);

/** 'video/mp4; codecs="avc1.640028, mp4a.40.2"' → ['h264', 'aac']. Bez parametru codecs → []. */
export function codecsOf(mime) {
  if (typeof mime !== 'string') return [];
  const match = /codecs\s*=\s*"?([^";]+)"?/i.exec(mime);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((code) => {
      for (const [prefix, name] of PREFIXES) {
        if (code === prefix || code.startsWith(`${prefix}.`)) return name;
      }
      return 'other';
    });
}

/** 'video/webm; codecs="vp9"; framerate=60' → 60, jinak null. */
export function framerateOf(mime) {
  if (typeof mime !== 'string') return null;
  const match = /framerate\s*=\s*"?(\d+(?:\.\d+)?)/i.exec(mime);
  return match ? Number(match[1]) : null;
}

/** Má se MIME typ hlásit jako nepodporovaný? cfg = { blocked: string[], cap30: boolean }. */
export function isBlocked(mime, cfg) {
  if (!cfg) return false;
  const blocked = Array.isArray(cfg.blocked) ? cfg.blocked : [];
  if (blocked.length > 0 && codecsOf(mime).some((codec) => blocked.includes(codec))) return true;
  if (cfg.cap30) {
    const framerate = framerateOf(mime);
    if (framerate !== null && framerate > 30) return true;
  }
  return false;
}

/** Totéž pro konfiguraci `navigator.mediaCapabilities.decodingInfo()`. */
export function isDecodingConfigBlocked(config, cfg) {
  if (!cfg || !config || typeof config !== 'object') return false;
  const { video, audio } = config;
  if (video && typeof video.contentType === 'string' && isBlocked(video.contentType, cfg)) return true;
  if (audio && typeof audio.contentType === 'string' && isBlocked(audio.contentType, cfg)) return true;
  if (cfg.cap30 && video && typeof video.framerate === 'number' && video.framerate > 30) return true;
  return false;
}


/**
 * Z nastavení sestaví konfiguraci pro MAIN world (ukládá se do localStorage stránky).
 * Pojistka: vždy zůstane povolený aspoň jeden video a jeden audio kodek.
 */
export function buildCodecConfig(settings) {
  const codecs = settings.codecs;
  let blocked = [];
  if (codecs.enabled) {
    const set = new Set(codecs.disabled.filter((codec) => VIDEO_CODECS.includes(codec)));
    for (const codec of codecs.audioDisabled) if (AUDIO_CODECS.includes(codec)) set.add(codec);
    if (VIDEO_CODECS.every((codec) => set.has(codec))) {
      const keep = codecs.order.filter((codec) => VIDEO_CODECS.includes(codec)).at(-1) ?? 'h264';
      set.delete(keep);
    }
    if (AUDIO_CODECS.every((codec) => set.has(codec))) set.delete('aac');
    blocked = [...VIDEO_CODECS, ...AUDIO_CODECS].filter((codec) => set.has(codec));
  }
  const cap30 = Boolean(settings.quality.enabled && settings.quality.fps === 'cap30');
  return { v: 1, blocked, cap30 };
}

/** Konfigurace, která nic neblokuje, se do localStorage vůbec nezapisuje. */
export function isCodecConfigActive(cfg) {
  return Boolean(cfg && ((Array.isArray(cfg.blocked) && cfg.blocked.length > 0) || cfg.cap30));
}

/** Normalizovaný klíč pro porovnání „načteno při startu“ vs. „aktuální nastavení“. */
export function codecConfigKey(cfg) {
  if (!isCodecConfigActive(cfg)) return 'none';
  return JSON.stringify({ blocked: [...cfg.blocked].sort(), cap30: Boolean(cfg.cap30) });
}

/** Bezpečné načtení konfigurace z localStorage (řetězec JSON). */
export function parseCodecConfig(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const cfg = JSON.parse(raw);
    if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.blocked)) return null;
    const known = [...VIDEO_CODECS, ...AUDIO_CODECS];
    return { v: 1, blocked: cfg.blocked.filter((codec) => known.includes(codec)), cap30: cfg.cap30 === true };
  } catch {
    return null;
  }
}

