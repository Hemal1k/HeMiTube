/** Obecné pomocné funkce. Nesmí při importu sahat na `window`, `document` ani `chrome`, aby šly testovat v Node. */

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** ID videa z URL: /watch?v=, /shorts/<id>, /live/<id>, /embed/<id>. Neplatné ID → null. */
export function getVideoId(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  let id = null;
  if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const match = /^\/(?:shorts|live|embed|v|e)\/([^/?#]+)/.exec(url.pathname);
    if (match) id = match[1];
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

/** Živá stránka kanálu (/@kanal/live, /channel/…/live, /c/…/live): video se přehrává bez ID v adrese. */
export const CHANNEL_LIVE_RE = /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/live\/?$/;

/**
 * Typ stránky: watch | shorts | embed | other (+ ID videa). Živý přenos /live/<id> se bere jako watch.
 * domVideoId = ID z přehrávače na stránce (ytd-watch-flexy[video-id]); použije se jen u živé stránky
 * kanálu, kde v adrese ID není.
 */
export function getPageInfo(href, domVideoId = null) {
  let path;
  try {
    path = new URL(href).pathname;
  } catch {
    return { pageType: 'other', videoId: null };
  }
  let pageType = 'other';
  if (path === '/watch' || path.startsWith('/live/')) pageType = 'watch';
  else if (path.startsWith('/shorts/')) pageType = 'shorts';
  else if (path.startsWith('/embed/')) pageType = 'embed';
  else if (CHANNEL_LIVE_RE.test(path)) {
    const id = typeof domVideoId === 'string' && VIDEO_ID_RE.test(domVideoId) ? domVideoId : null;
    return { pageType: id ? 'watch' : 'other', videoId: id };
  }
  const videoId = getVideoId(href);
  return { pageType: videoId ? pageType : 'other', videoId };
}

/**
 * Kompaktní formát podle jazyka: „1,2 tis.“ (cs), „1.2K“ (en).
 * Neplatné číslo → „–“. Neplatný jazykový tag → výchozí jazyk prostředí.
 */
export function formatCount(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '–';
  const options = { notation: 'compact', compactDisplay: 'short' };
  try {
    return new Intl.NumberFormat(locale || undefined, options).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, options).format(value);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/**
 * Počká, až `check()` vrátí pravdivou hodnotu (MutationObserver + kontrola každých 500 ms).
 * Po `timeout` ms vrátí null. Použití jen v prohlížeči.
 */
export function waitFor(check, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const first = check();
    if (first) {
      resolve(first);
      return;
    }
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timer);
      resolve(value);
    };
    const tick = () => {
      const value = check();
      if (value) finish(value);
    };
    const observer = new MutationObserver(tick);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const interval = setInterval(tick, 500);
    const timer = setTimeout(() => finish(null), timeout);
  });
}

export function toggleAttr(element, name, on, value = '') {
  if (!element) return;
  if (on) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  } else if (element.hasAttribute(name)) {
    element.removeAttribute(name);
  }
}

export function isVisible(element) {
  return Boolean(element) && element.offsetWidth > 0 && element.offsetHeight > 0;
}

/** Video, které se právě přehrává (jinak první s obrazem), nebo null. Použití jen v prohlížeči. */
export function findActiveVideo() {
  const videos = [...document.querySelectorAll('video')].filter((video) => video.videoWidth > 0);
  return videos.find((video) => !video.paused) ?? videos[0] ?? null;
}

/** Krátká zpráva v přehrávači (host); předchozí zpráva stejné třídy se nahradí. Použití jen v prohlížeči. */
export function showPlayerToast(host, text, { className = 'ytk-player-toast', ms = 2500 } = {}) {
  host.querySelector(`.${className}`)?.remove();
  const toast = document.createElement('div');
  toast.className = className;
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), ms);
}
