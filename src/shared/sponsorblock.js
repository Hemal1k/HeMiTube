/**
 * SponsorBlock (https://sponsor.ajay.app, data CC BY-NC-SA 4.0): jen čtení segmentů, nic se neodesílá.
 * Dotaz se posílá podle prvních 4 znaků SHA-256 hashe ID videa, takže server nezjistí, které video přesně hraje.
 * Čisté funkce, testy: tests/sponsorblock.test.mjs.
 */
import { SB_CATEGORIES } from './settings.js';

export const SB_ORIGIN = 'https://sponsor.ajay.app/*';
export const SB_API = 'https://sponsor.ajay.app/api/skipSegments/';
export const SB_CACHE_TTL_MS = 30 * 60 * 1000;
/** Kousek před koncem segmentu, kdy už se nepřeskakuje (aby se neskákalo o zlomek sekundy). */
const END_MARGIN_S = 0.4;

/** URL dotazu pro prefix hashe (všechny kategorie, jen akce „skip“; výběr kategorií se dělá až v prohlížeči). */
export function sbQueryUrl(hashPrefix) {
  const categories = encodeURIComponent(JSON.stringify(SB_CATEGORIES));
  const actionTypes = encodeURIComponent(JSON.stringify(['skip']));
  return `${SB_API}${hashPrefix}?categories=${categories}&actionTypes=${actionTypes}`;
}

/** Odpověď API (pole videí se segmenty) → platné segmenty daného videa seřazené podle začátku. */
export function parseSegments(json, videoId) {
  if (!Array.isArray(json)) return [];
  const video = json.find((item) => item && item.videoID === videoId);
  if (!video || !Array.isArray(video.segments)) return [];
  return video.segments
    .filter(
      (item) =>
        item &&
        item.actionType === 'skip' &&
        SB_CATEGORIES.includes(item.category) &&
        Array.isArray(item.segment) &&
        Number.isFinite(item.segment[0]) &&
        Number.isFinite(item.segment[1]) &&
        item.segment[1] > item.segment[0],
    )
    .map((item) => ({ start: item.segment[0], end: item.segment[1], category: item.category, uuid: item.UUID ? String(item.UUID) : `${item.segment[0]}-${item.segment[1]}` }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Segment, který se má právě přeskočit: čas je uvnitř, kategorie je zapnutá a segment ještě
 * nebyl přeskočen (když se uživatel do segmentu vrátí sám, nechá se přehrát).
 */
export function segmentToSkip(segments, time, categories, skipped = new Set()) {
  if (!Array.isArray(segments) || !Number.isFinite(time)) return null;
  return (
    segments.find(
      (segment) =>
        categories.includes(segment.category) &&
        !skipped.has(segment.uuid) &&
        time >= segment.start &&
        time < segment.end - END_MARGIN_S,
    ) ?? null
  );
}
