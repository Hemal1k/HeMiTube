/**
 * Modul: smyčka přes klávesové zkratky (volitelné – zkratky nemají výchozí klávesy).
 * - loop-toggle: opakovat celé video (vlastní: těsně před koncem zpět na začátek, takže se
 *   nespustí ani automatické přehrání dalšího videa; nativní player.setLoop u běžných videí nezabírá)
 * - loop-a / loop-b: začátek a konec úseku → úsek A–B se opakuje
 * - loop-clear: zrušit smyčku
 * Při změně videa se smyčka zruší.
 */
import { YT } from '../shared/selectors.js';
import { getPageInfo, showPlayerToast } from '../shared/utils.js';
import { t } from '../shared/i18n.js';

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function mainVideo() {
  return document.querySelector(`#movie_player video, .${YT.playerClass} video`);
}

export function initLoop(ctx) {
  if (!ctx.isTop) return null;

  let page = getPageInfo(location.href);
  let whole = false;
  let pointA = null;
  let range = null; // { a, b }

  function toast(text) {
    showPlayerToast(mainVideo()?.closest(`.${YT.playerClass}`) ?? document.body, text);
  }

  function clear(silent = false) {
    const had = whole || range || pointA !== null;
    whole = false;
    range = null;
    pointA = null;
    if (had && !silent) toast(t('loopOff'));
  }

  function onCommand(command) {
    const video = mainVideo();
    if (!video || !['watch', 'embed'].includes(page.pageType)) return;
    if (command === 'loop-toggle') {
      range = null;
      pointA = null;
      whole = !whole;
      toast(t(whole ? 'loopWhole' : 'loopOff'));
    } else if (command === 'loop-a') {
      pointA = video.currentTime;
      range = null;
      toast(t('loopPointA', [formatTime(pointA)]));
    } else if (command === 'loop-b') {
      if (pointA === null) {
        toast(t('loopNeedA'));
        return;
      }
      const b = video.currentTime;
      if (b <= pointA + 0.5) {
        toast(t('loopBBeforeA'));
        return;
      }
      whole = false;
      range = { a: pointA, b };
      toast(t('loopRange', [formatTime(range.a), formatTime(range.b)]));
      video.currentTime = range.a;
    } else if (command === 'loop-clear') {
      clear();
    }
  }

  const END_MARGIN_S = 0.6; // dřív než „ended“, jinak YouTube spustí další video

  // Úsek A–B: po dosažení konce zpět na začátek. Celé video: těsně před koncem zpět na 0.
  document.addEventListener(
    'timeupdate',
    (event) => {
      const video = event.target;
      if (video !== mainVideo()) return;
      if (range && video.currentTime >= range.b) video.currentTime = range.a;
      else if (whole && Number.isFinite(video.duration) && video.currentTime >= video.duration - END_MARGIN_S) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    },
    true,
  );

  return {
    onCommand,
    onNavigate(info) {
      if (info.videoId !== page.videoId) clear(true);
      page = info;
    },
  };
}
