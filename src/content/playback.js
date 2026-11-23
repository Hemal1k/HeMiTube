/**
 * Modul: výchozí rychlost přehrávání (volitelný).
 * Rychlost se nastaví jednou na každé video (po načtení a po reklamě) přes API přehrávače,
 * takže ji uživatel může během videa ručně změnit a modul ji nepřepíše. Živé přenosy
 * a volitelně hudba se přehrávají normální rychlostí (rozhoduje MAIN world).
 */
import { debounce, getPageInfo, sleep } from '../shared/utils.js';

const RETRIES = 8;
const RETRY_DELAY_MS = 500;

export function initPlayback(ctx) {
  const isEmbed = location.pathname.startsWith('/embed/');
  if (!ctx.isTop && !isEmbed) return null;

  let settings = ctx.getSettings();
  let page = getPageInfo(location.href);
  let doneFor = null; // video, u kterého už je rozhodnuto
  let changedFor = null; // video, kterému modul rychlost opravdu změnil
  let running = false;

  const relevant = () => settings.playback.enabled && ['watch', 'embed'].includes(page.pageType) && Boolean(page.videoId);

  async function apply() {
    if (!relevant() || doneFor === page.videoId || running) return;
    running = true;
    try {
      const videoId = page.videoId;
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        if (videoId !== page.videoId || !relevant()) return;
        const result = await ctx.bridge
          .call('applyPlaybackRate', {
            speed: settings.playback.speed,
            skipMusic: settings.playback.skipMusic,
            videoId,
            resetIfSkipped: changedFor === videoId,
          })
          .catch(() => null);
        if (result?.done) {
          doneFor = videoId;
          if (result.reason === 'set') changedFor = videoId;
          else if (changedFor === videoId) changedFor = null; // hudba/živý přenos → vráceno na 1×
          return;
        }
        if (result?.reason === 'ad') return; // po reklamě přijde canplay a zkusí se znovu
        await sleep(RETRY_DELAY_MS);
      }
    } finally {
      running = false;
    }
  }

  const schedule = debounce(apply, 250);

  document.addEventListener(
    'canplay',
    (event) => {
      if (event.target instanceof HTMLVideoElement) schedule();
    },
    true,
  );

  return {
    onSettings(next) {
      const before = settings.playback;
      settings = next;
      if (before.enabled && !next.playback.enabled && changedFor && changedFor === page.videoId) {
        changedFor = null;
        doneFor = null; // po opětovném zapnutí se rychlost znovu nastaví i na tomto videu
        ctx.bridge.call('applyPlaybackRate', { speed: '1', skipMusic: false, videoId: page.videoId }).catch(() => {});
        return;
      }
      // Změna rychlosti nebo zapnutí modulu → použít i na právě hrající video.
      if (before.speed !== next.playback.speed || before.enabled !== next.playback.enabled || before.skipMusic !== next.playback.skipMusic) {
        doneFor = null;
        schedule();
      }
    },
    onNavigate(info) {
      page = isEmbed ? { ...info, pageType: 'embed' } : info;
      if (info.videoId !== doneFor) schedule();
    },
  };
}
