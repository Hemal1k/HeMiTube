/**
 * Modul 3: automatická kvalita.
 * Tady se rozhoduje KDY (změna videa, canplay, konec reklamy),
 * MAIN world (player-api.js) kvalitu nastaví přes API přehrávače.
 * Když API nezabere, jednou za video se použije záloha: klikání do menu kvality (postup od avi12).
 */
import { SELECTORS, q, qAll, YT } from '../shared/selectors.js';
import { effectivePreferred } from '../shared/quality-logic.js';
import { debounce, getPageInfo, sleep } from '../shared/utils.js';

const VERIFY_DELAY_MS = 1500;
const QUALITY_TEXT_RE = /^\s*\d{3,4}p/;

export function initQuality(ctx) {
  const isEmbed = location.pathname.startsWith('/embed/');
  if (!ctx.isTop && !isEmbed) return null;

  let settings = ctx.getSettings();
  let page = getPageInfo(location.href);
  let manualFor = null; // uživatel si kvalitu u tohoto videa zvolil sám
  let fallbackDoneFor = null;
  let observedPlayer = null;
  let playerObserver = null;
  let adShowing = false;
  let running = false;
  let rerun = false;
  // Kvalita se u jednoho videa nastaví jen jednou (klíč video|preferovaná kvalita). Každé přepnutí
  // kvality přehrávač znovu načte a vyvolá canplay; bez této pojistky by se při pomalém přepnutí
  // nastavovala dokola a video by se opakovaně načítalo od začátku (zaseknutí kolem 1 s).
  let appliedKey = null;

  function relevant() {
    return settings.quality.enabled && ['watch', 'shorts', 'embed'].includes(page.pageType) && manualFor !== page.videoId;
  }

  async function apply() {
    if (!relevant()) return;
    if (running) {
      rerun = true; // přišel další podnět během ověřování → po dokončení proběhne znovu
      return;
    }
    running = true;
    rerun = false;
    try {
      const qs = settings.quality;
      const videoId = page.videoId;
      const preferred = effectivePreferred(qs, isEmbed ? 'embed' : 'default');
      const key = `${videoId}|${preferred}`;
      if (appliedKey === key) return;
      const result = await ctx.bridge.call('applyQuality', { preferred }).catch(() => null);
      if (!result?.ok) return; // přehrávač ještě není připravený → zkusí se při dalším canplay
      appliedKey = key;

      await sleep(VERIFY_DELAY_MS);
      if (videoId !== page.videoId || !relevant()) return;
      const info = await ctx.bridge.call('getPlayerInfo').catch(() => null);
      if (!info || info.adShowing || info.quality === result.target) return;
      if (fallbackDoneFor === videoId) return;
      fallbackDoneFor = videoId;
      await menuFallback(result.targetHeight);
    } finally {
      running = false;
      if (rerun) schedule();
    }
  }

  const schedule = debounce(apply, 300);

  async function menuFallback(height) {
    const player = q('player');
    const button = q('settingsButton', player);
    if (!player || !button || button.getAttribute('aria-expanded') === 'true') return;
    button.click();
    await sleep(200);
    const row = qAll('settingsMenuItem', player).find((item) =>
      /\d{3,4}p/.test(q('menuItemContent', item)?.textContent ?? ''),
    );
    if (row) row.click();
    else q('qualityDropDownTrigger', player)?.click();
    await sleep(200);
    const options = [...player.querySelectorAll([...SELECTORS.settingsMenuItem, ...SELECTORS.qualityDropDownOption].join(','))]
      .filter((item) => QUALITY_TEXT_RE.test(item.textContent ?? '') && !q('premiumLabel', item));
    options.find((item) => parseInt(item.textContent, 10) === height)?.click();
    await sleep(150);
    if (button.getAttribute('aria-expanded') === 'true') button.click();
    button.blur();
  }

  function watchPlayer() {
    const player = q('player');
    if (!player || player === observedPlayer) return;
    playerObserver?.disconnect();
    observedPlayer = player;
    adShowing = player.classList.contains(YT.adShowingClass);
    playerObserver = new MutationObserver(() => {
      const nowAd = player.classList.contains(YT.adShowingClass);
      if (nowAd === adShowing) return;
      adShowing = nowAd;
      if (!nowAd) {
        appliedKey = null; // konec reklamy → znovu nastavit kvalitu videa
        schedule();
      }
    });
    playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  // canplay neprobublává, zachytávací fáze ho ale chytí pro všechna <video> včetně nově vytvořených.
  document.addEventListener(
    'canplay',
    (event) => {
      if (!(event.target instanceof HTMLVideoElement)) return;
      watchPlayer();
      schedule();
    },
    true,
  );

  // Ruční volba uživatele (skutečné kliknutí) má přednost až do další změny videa.
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const item = event.target.closest([...SELECTORS.settingsMenuItem, ...SELECTORS.qualityDropDownOption].join(','));
      if (item && QUALITY_TEXT_RE.test(item.textContent ?? '')) manualFor = page.videoId;
    },
    true,
  );

  return {
    onSettings(next) {
      const before = settings.quality;
      settings = next;
      // Jen změna kvality přepíše ruční volbu u aktuálního videa (ne změna jiného modulu).
      if (JSON.stringify(before) === JSON.stringify(next.quality)) return;
      manualFor = null;
      appliedKey = null;
      schedule();
    },
    onNavigate(info) {
      if (info.videoId !== page.videoId) {
        manualFor = null;
        fallbackDoneFor = null;
        appliedKey = null;
      }
      page = isEmbed ? { ...info, pageType: 'embed' } : info;
      watchPlayer();
      schedule();
    },
  };
}
