/**
 * Jediný zdroj události „změnilo se video / stránka“ pro všechny moduly.
 * YouTube je SPA: kombinuje události YouTube (yt-navigate-finish, yt-page-data-updated),
 * popstate a kontrolu URL každou sekundu (Shorts při posunu nemusí vyvolat žádnou událost).
 */
import { getPageInfo } from './utils.js';

export function createNavigationWatcher(onChange) {
  let lastKey = null;
  const check = () => {
    // Živá stránka kanálu (/@kanal/live) nemá ID v adrese → vezme se z přehrávače na stránce.
    const info = getPageInfo(location.href, document.querySelector('ytd-watch-flexy')?.getAttribute('video-id'));
    const key = `${info.pageType}:${info.videoId}`;
    if (key === lastKey) return;
    lastKey = key;
    onChange(info);
  };
  document.addEventListener('yt-navigate-finish', check);
  document.addEventListener('yt-page-data-updated', check);
  window.addEventListener('popstate', check);
  setInterval(check, 1000);
  check();
  return { check };
}
