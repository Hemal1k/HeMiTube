/** Return YouTube Dislike API: jen čtení počtů. Žádné hlasování, registrace ani proof-of-work. */

export const RYD_VOTES_URL = 'https://returnyoutubedislikeapi.com/votes?videoId=';
export const RYD_CACHE_TTL_MS = 10 * 60 * 1000;
export const RYD_BACKOFF_MS = 60 * 1000;

const count = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

/** Odpověď API → { likes, dislikes } nebo null, když chybí platná čísla. */
export function parseVotes(json) {
  if (!json || typeof json !== 'object') return null;
  const dislikes = count(json.dislikes);
  if (dislikes === null) return null;
  return { likes: count(json.likes) ?? 0, dislikes };
}

/** Je záznam v cache ještě platný? entry = { t: čas uložení, d: data } */
export function isCacheFresh(entry, now, ttl = RYD_CACHE_TTL_MS) {
  return Boolean(entry && typeof entry.t === 'number' && entry.d && now - entry.t >= 0 && now - entry.t < ttl);
}
