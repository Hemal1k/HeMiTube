/**
 * Modul: snímek obrazovky videa klávesovou zkratkou (volitelný – zkratka nemá výchozí klávesu).
 * Aktuální snímek <video> v plném rozlišení streamu se vykreslí do canvasu a stáhne jako PNG.
 * Video z YouTube se přehrává přes MediaSource (blob: URL stejného původu), takže canvas není „tainted“.
 */
import { YT } from '../shared/selectors.js';
import { t } from '../shared/i18n.js';

const TOAST_CLASS = 'ytk-player-toast';
const TOAST_MS = 2500;

function findVideo() {
  const videos = [...document.querySelectorAll('video')].filter((video) => video.videoWidth > 0);
  return videos.find((video) => !video.paused) ?? videos[0] ?? null;
}

/** Bezpečný název souboru: „Název videa – 1-23-45.png“ (bez znaků, které Windows/macOS nepovolí). */
export function screenshotFileName(title, seconds) {
  const clean = [...String(title || 'YouTube').replace(/\s*-\s*YouTube\s*$/i, '')]
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char)) // řídicí znaky pryč
    .join('')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'YouTube';
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const time = h > 0 ? `${h}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}` : `${m}-${String(s).padStart(2, '0')}`;
  return `${clean} – ${time}.png`;
}

export function initScreenshot(ctx) {
  if (!ctx.isTop) return null;

  function showToast(video, text) {
    const host = video.closest(`.${YT.playerClass}`) ?? document.body;
    host.querySelector(`.${TOAST_CLASS}`)?.remove();
    const toast = document.createElement('div');
    toast.className = TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.textContent = text;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), TOAST_MS);
  }

  function capture() {
    const video = findVideo();
    if (!video) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          showToast(video, t('screenshotFailed'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = screenshotFileName(document.title, video.currentTime);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast(video, t('screenshotSaved', [`${canvas.width} × ${canvas.height}`]));
      }, 'image/png');
    } catch {
      showToast(video, t('screenshotFailed'));
    }
  }

  return {
    onCommand(command) {
      if (command === 'screenshot') capture();
    },
  };
}
