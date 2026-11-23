/**
 * Modul 5: skrytí Shorts na YouTube.
 * - CSS pravidla se sestaví ze SELECTORS.shortsHide a platí jen při atributu ytk-hide-shorts na <html>,
 *   takže vypnutí modulu je okamžité.
 * - Filtr „Shorts“ ve vyhledávání nemá atribut → označí se podle textu (data-ytk-shorts).
 * - Volitelně se Shorts otevírají v běžném přehrávači (/shorts/<id> → /watch?v=<id>).
 */
import { SELECTORS, SHORTS_LABEL, qAll } from '../shared/selectors.js';
import { debounce, toggleAttr } from '../shared/utils.js';

const ROOT_ATTR = 'ytk-hide-shorts';
const MARK_ATTR = 'data-ytk-shorts';
const SHORTS_LINK_RE = /^\/shorts\/([A-Za-z0-9_-]{11})/;

function buildStyle() {
  const rules = [...SELECTORS.shortsHide.map((selector) => `html[${ROOT_ATTR}] ${selector}`), `html[${ROOT_ATTR}] [${MARK_ATTR}]`]
    .map((selector) => `${selector} { display: none !important; }`)
    .join('\n');
  const style = document.createElement('style');
  style.id = 'ytk-hide-shorts-style';
  style.textContent = rules;
  return style;
}

export function initHideShorts(ctx) {
  if (!ctx.isTop || location.hostname !== 'www.youtube.com') return null;

  const root = document.documentElement;
  let settings = ctx.getSettings();
  let observer = null;
  let observerTimer = null;
  const OBSERVE_MS = 8000; // filtry se vykreslí krátce po navigaci, pak už observer není potřeba

  root.appendChild(buildStyle());

  const enabled = () => settings.hideShorts.enabled;
  const redirect = () => settings.hideShorts.enabled && settings.hideShorts.redirect;

  function markChips() {
    for (const chip of qAll('shortsChips')) {
      const isShorts = chip.textContent.trim() === SHORTS_LABEL;
      if (isShorts && !chip.hasAttribute(MARK_ATTR)) chip.setAttribute(MARK_ATTR, '');
    }
  }
  const scheduleMark = debounce(markChips, 200);

  function stopObserving() {
    clearTimeout(observerTimer);
    observer?.disconnect();
    observer = null;
  }

  /** Krátkodobý observer po navigaci/zapnutí (místo trvalého sledování celého dokumentu). */
  function observeBriefly() {
    stopObserving();
    if (!enabled()) return;
    observer = new MutationObserver(scheduleMark);
    observer.observe(root, { childList: true, subtree: true });
    observerTimer = setTimeout(stopObserving, OBSERVE_MS);
    markChips();
  }

  function update() {
    toggleAttr(root, ROOT_ATTR, enabled());
    if (enabled()) observeBriefly();
    else stopObserving();
  }

  function redirectIfShorts(info) {
    if (!redirect() || info.pageType !== 'shorts' || !info.videoId) return;
    location.replace(`/watch?v=${info.videoId}`);
  }

  // Kliknutí na odkaz Shorts (SPA navigace) rovnou do běžného přehrávače.
  document.addEventListener(
    'click',
    (event) => {
      if (!redirect() || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="/shorts/"]') : null;
      const match = link && SHORTS_LINK_RE.exec(link.getAttribute('href'));
      if (!match) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      location.assign(`/watch?v=${match[1]}`);
    },
    true,
  );

  update();

  return {
    onSettings(next) {
      settings = next;
      update();
    },
    onNavigate(info) {
      redirectIfShorts(info);
      if (enabled()) observeBriefly();
    },
  };
}
