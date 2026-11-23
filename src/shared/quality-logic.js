/** Čisté funkce pro výběr kvality. Testy: tests/quality.test.mjs. */

export const QUALITY_HEIGHTS = Object.freeze([4320, 2160, 1440, 1080, 720, 480, 360, 240, 144]);

/** Výška → interní název kvality v API přehrávače YouTube (podle avi12/youtube-auto-hd). */
export const QUALITY_KEYS = Object.freeze({
  4320: 'highres',
  2160: 'hd2160',
  1440: 'hd1440',
  1080: 'hd1080',
  720: 'hd720',
  480: 'large',
  360: 'medium',
  240: 'small',
  144: 'tiny',
});

const KEY_TO_HEIGHT = Object.freeze(
  Object.fromEntries(Object.entries(QUALITY_KEYS).map(([height, key]) => [key, Number(height)])),
);

/** „1080p60 HD“ → { height: 1080, fps: 60 }, „720p“ → { height: 720, fps: null }. */
export function parseLabel(label) {
  const match = /(\d{3,4})[ps](\d{2,3})?/.exec(typeof label === 'string' ? label : '');
  return {
    height: match ? Number(match[1]) : null,
    fps: match && match[2] ? Number(match[2]) : null,
  };
}

/** Výstup `player.getAvailableQualityData()` → [{ quality, height, fps, label }] seřazené sestupně. */
export function normalizeQualityData(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const out = [];
  for (const item of data) {
    if (!item || typeof item.quality !== 'string' || item.quality === 'auto') continue;
    if (item.isPlayable === false) continue;
    if (seen.has(item.quality)) continue;
    const parsed = parseLabel(item.qualityLabel);
    const height = KEY_TO_HEIGHT[item.quality] ?? parsed.height;
    if (!height) continue;
    seen.add(item.quality);
    out.push({ quality: item.quality, height, fps: parsed.fps ?? 30, label: item.qualityLabel || item.quality });
  }
  return out.sort((a, b) => b.height - a.height);
}

/** Výstup `player.getAvailableQualityLevels()` (např. ["hd1080", "hd720", "auto"]) → stejný tvar, FPS neznámé (30). */
export function normalizeQualityLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return normalizeQualityData(levels.map((quality) => ({ quality, qualityLabel: '' })));
}

/**
 * Vybere kvalitu z dostupných.
 * - preferred: 'max', 'screen' (podle obrazovky) nebo výška jako řetězec/číslo ('1080').
 * - screenHeight: výška obrazovky ve fyzických pixelech (jen pro 'screen').
 * - fallback: 'higher' (výchozí, používá se vždy) = když přesná není, nejbližší vyšší;
 *             když vyšší není, nejvyšší dostupná. 'lower' = opačně (jen pro testy a případné použití).
 * - fps: 'none' (Automaticky) / 'cap30' výběr neovlivňují; cap30 řeší blokace streamů nad 30 fps
 *        v MAIN worldu (codecs.js), takže 60fps varianty v nabídce vůbec nejsou.
 */
export function pickQuality(available, preferred, { fallback = 'higher', screenHeight = 0 } = {}) {
  if (!Array.isArray(available) || available.length === 0) return null;
  if (preferred === 'screen') {
    // Nikdy víc, než obrazovka ukáže: nejbližší nižší (jinak nejnižší dostupná).
    return pickQuality(available, screenQuality(screenHeight), { fallback: 'lower' });
  }
  const list = [...available].sort((a, b) => b.height - a.height);
  let index = 0;
  if (preferred !== 'max' && preferred !== null && preferred !== undefined) {
    const target = Number(preferred);
    if (Number.isFinite(target)) {
      const exact = list.findIndex((option) => option.height === target);
      if (exact >= 0) {
        index = exact;
      } else if (fallback === 'higher') {
        const higher = list.findLastIndex((option) => option.height > target);
        index = higher >= 0 ? higher : 0;
      } else {
        const lower = list.findIndex((option) => option.height < target);
        index = lower >= 0 ? lower : list.length - 1;
      }
    }
  }
  return list[index];
}

/**
 * Kvalita „podle obrazovky“: nejmenší standardní výška, která pokryje obrazovku (s 10% tolerancí).
 * 900 → 1080, 1080 → 1080, 1200 → 1080, 1440 → 1440, 1600 → 1440, 2160 → 2160.
 * Neznámá výška obrazovky → 1080.
 */
export function screenQuality(screenHeight) {
  const height = Number(screenHeight);
  if (!Number.isFinite(height) || height <= 0) return '1080';
  const fits = [...QUALITY_HEIGHTS].reverse().find((standard) => standard >= height * 0.9);
  return String(fits ?? QUALITY_HEIGHTS[0]);
}

/**
 * Preferovaná kvalita: ve vložených videích (embed) zvláštní volba, jinak hlavní.
 * Hodnota null u zvláštní volby = stejná jako hlavní.
 */
export function effectivePreferred(quality, mode) {
  const pick = (value) => (value === null || value === undefined ? quality.preferred : value);
  if (mode === 'embed') return pick(quality.embedPreferred);
  return quality.preferred;
}
