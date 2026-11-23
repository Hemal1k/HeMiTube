/**
 * Modul: přeskakování sponzorovaných a dalších částí videa podle SponsorBlocku (volitelný).
 * Segmenty načítá service worker (vyžaduje volitelné oprávnění k sponsor.ajay.app).
 * Přeskakuje se nastavením video.currentTime; každý segment jen jednou, takže když se
 * uživatel do segmentu vrátí sám, nechá se přehrát.
 */
import { YT } from '../shared/selectors.js';
import { segmentToSkip } from '../shared/sponsorblock.js';
import { getPageInfo } from '../shared/utils.js';
import { t } from '../shared/i18n.js';

const TOAST_CLASS = 'ytk-sb-toast';
const PLAYER_CLASS_SELECTOR = `.${YT.playerClass}`;
const TOAST_MS = 3000;

export function initSponsorBlock(ctx) {
  const isEmbed = location.pathname.startsWith('/embed/');
  if (!ctx.isTop && !isEmbed) return null;

  let settings = ctx.getSettings();
  let page = getPageInfo(location.href);
  let segments = [];
  let segmentsFor = null;
  let skipped = new Set();
  let generation = 0;

  const relevant = () => settings.sponsorBlock.enabled && ['watch', 'embed'].includes(page.pageType) && Boolean(page.videoId);

  async function load() {
    const current = ++generation;
    segments = [];
    segmentsFor = null;
    skipped = new Set();
    if (!relevant()) return;
    const videoId = page.videoId;
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'sb:get', videoId });
    } catch {
      response = null;
    }
    if (current !== generation || !response?.ok || !Array.isArray(response.segments)) return;
    segments = response.segments;
    segmentsFor = videoId;
  }

  function showToast(player, category) {
    if (!settings.sponsorBlock.notify || !player) return;
    player.querySelector(`.${TOAST_CLASS}`)?.remove();
    const toast = document.createElement('div');
    toast.className = TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.textContent = t('sbSkipped', [t(`sbCat_${category}`)]);
    player.appendChild(toast);
    setTimeout(() => toast.remove(), TOAST_MS);
  }

  // timeupdate neprobublává, zachytávací fáze ho chytí pro všechna <video>.
  document.addEventListener(
    'timeupdate',
    (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !relevant() || segmentsFor !== page.videoId || segments.length === 0) return;
      const player = video.closest(PLAYER_CLASS_SELECTOR);
      if (!player || player.classList.contains(YT.adShowingClass)) return;
      const segment = segmentToSkip(segments, video.currentTime, settings.sponsorBlock.categories, skipped);
      if (!segment) return;
      skipped.add(segment.uuid);
      video.currentTime = segment.end;
      showToast(player, segment.category);
    },
    true,
  );

  return {
    onSettings(next) {
      const wasEnabled = settings.sponsorBlock.enabled;
      settings = next;
      if (!wasEnabled && next.sponsorBlock.enabled) load();
    },
    onNavigate(info) {
      const changed = info.videoId !== page.videoId;
      page = isEmbed ? { ...info, pageType: 'embed' } : info;
      if (changed || segmentsFor !== page.videoId) load();
    },
  };
}
