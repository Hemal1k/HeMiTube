/**
 * Modul 1: režim kina přes celé okno.
 *
 * Vzhled řeší content.css podle atributů na <html>:
 *   ytk-full-window     – roztáhnout přehrávač na výšku okna
 *   ytk-hide-masthead   – skrýt horní lištu
 *   ytk-reveal          – kdy lištu ukázat (hover | scroll | both | never)
 *   ytk-in-theater      – právě jsme na stránce sledování v režimu kina (ne celá obrazovka)
 *   ytk-masthead-visible – lišta je dočasně zobrazená
 * Automatické zapnutí kina používá nativní tlačítko YouTube (.ytp-size-button).
 */
import { q, YT } from '../shared/selectors.js';
import { sleep, toggleAttr, waitFor } from '../shared/utils.js';

const AUTO_ATTEMPTS = 10;
const AUTO_DELAY_MS = 400; // YouTube napojí handler tlačítka až chvíli po jeho vložení (poznatek od avi12)
const HIDE_DELAY_MS = 600;
const SCROLL_REVEAL_RATIO = 0.01;

export function initTheater(ctx) {
  if (!ctx.isTop || location.hostname !== 'www.youtube.com') return null;

  const root = document.documentElement;
  let settings = ctx.getSettings();
  let page = { pageType: 'other', videoId: null };
  let observedFlexy = null;
  let flexyObserver = null;
  let autoDoneFor = null;
  let hideTimer = null;
  let mastheadBound = null;
  let revealZone = null;

  const flexy = () => q('watchFlexy');
  const revealMode = () => settings.theater.revealMasthead;

  function isInTheater() {
    const element = flexy();
    return (
      page.pageType === 'watch' &&
      Boolean(element) &&
      element.hasAttribute(YT.theaterAttr) &&
      !element.hasAttribute(YT.fullscreenAttr) &&
      !document.fullscreenElement
    );
  }

  function setMastheadVisible(visible) {
    clearTimeout(hideTimer);
    toggleAttr(root, 'ytk-masthead-visible', visible);
  }

  let pinned = false; // lišta ukázaná klávesovou zkratkou zůstane vidět, dokud ji zkratka zase neskryje

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (pinned) return;
      const masthead = q('masthead');
      if (masthead?.matches(':hover') || masthead?.contains(document.activeElement)) return;
      if (scrollRevealActive()) return;
      toggleAttr(root, 'ytk-masthead-visible', false);
    }, HIDE_DELAY_MS);
  }

  function scrollRevealActive() {
    const mode = revealMode();
    return (mode === 'scroll' || mode === 'both') && window.scrollY > Math.max(10, window.innerHeight * SCROLL_REVEAL_RATIO);
  }

  let layoutKey = '';

  function update() {
    const t = settings.theater;
    toggleAttr(root, 'ytk-full-window', t.enabled && t.fullWindow);
    toggleAttr(root, 'ytk-hide-masthead', t.enabled && t.hideMasthead);
    toggleAttr(root, 'ytk-reveal', t.enabled, t.revealMasthead);
    toggleAttr(root, 'ytk-no-ambient', t.enabled && t.noAmbient);
    const inTheater = t.enabled && isInTheater();
    toggleAttr(root, 'ytk-in-theater', inTheater);
    if (!inTheater) {
      pinned = false;
      setMastheadVisible(false);
    }
    else if (scrollRevealActive()) setMastheadVisible(true);
    observeFlexy();

    // Přehrávač přepočítá velikost videa (letterbox) až při události resize – ověřeno na živém YouTube:
    // bez ní zůstane video v nově zvětšeném kontejneru původně velké a zarovnané nahoru.
    const key = ['ytk-full-window', 'ytk-hide-masthead', 'ytk-in-theater'].map((name) => root.hasAttribute(name)).join();
    if (key !== layoutKey) {
      layoutKey = key;
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }

  function observeFlexy() {
    const element = flexy();
    if (element === observedFlexy) return;
    flexyObserver?.disconnect();
    observedFlexy = element;
    if (!element) return;
    flexyObserver = new MutationObserver(update);
    flexyObserver.observe(element, { attributes: true, attributeFilter: [YT.theaterAttr, YT.fullscreenAttr, 'hidden'] });
  }

  function ensureRevealZone() {
    if (revealZone || !document.body) return;
    revealZone = document.createElement('div');
    revealZone.id = 'ytk-reveal-zone';
    revealZone.addEventListener('mouseenter', () => {
      setMastheadVisible(true);
      scheduleHide(); // skryje se, pokud myš nepřejde na lištu
    });
    document.body.appendChild(revealZone);
  }

  function bindMasthead(masthead) {
    if (!masthead || masthead === mastheadBound) return;
    mastheadBound = masthead;
    masthead.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    masthead.addEventListener('mouseleave', () => {
      if (root.hasAttribute('ytk-masthead-visible')) scheduleHide();
    });
    // Při psaní do vyhledávání lišta nesmí zmizet.
    masthead.addEventListener('focusin', () => {
      if (root.hasAttribute('ytk-in-theater')) setMastheadVisible(true);
    });
    masthead.addEventListener('focusout', () => scheduleHide());
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!root.hasAttribute('ytk-in-theater') || !settings.theater.hideMasthead) return;
      if (scrollRevealActive()) setMastheadVisible(true);
      else scheduleHide();
    },
    { passive: true },
  );
  document.addEventListener('fullscreenchange', update);

  waitFor(() => document.body).then(() => ensureRevealZone());
  waitFor(() => q('masthead'), { timeout: 30000 }).then(bindMasthead);

  async function autoTheater() {
    const t = settings.theater;
    if (!t.enabled || !t.autoTheater || page.pageType !== 'watch' || !page.videoId) return;
    const videoId = page.videoId;
    if (autoDoneFor === videoId) return;
    autoDoneFor = videoId; // jen jednou na video, ať neperu s uživatelem, který kino vypne

    const button = await waitFor(() => (page.videoId === videoId ? q('sizeButton', q('player') ?? document) : null));
    if (!button || page.videoId !== videoId) return;

    if (t.autoTheaterSkipLive) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const info = await ctx.bridge.call('getPlayerInfo', {}, 2000).catch(() => null);
        if (info?.videoId === videoId) {
          if (info.isLive) return;
          break;
        }
        await sleep(500);
      }
    }

    for (let attempt = 0; attempt < AUTO_ATTEMPTS; attempt++) {
      if (page.videoId !== videoId || !settings.theater.autoTheater) return;
      const element = flexy();
      if (element?.hasAttribute(YT.theaterAttr) || document.fullscreenElement) return;
      q('sizeButton', q('player') ?? document)?.click();
      await sleep(AUTO_DELAY_MS);
    }
  }

  update();

  let chatDoneFor = null;

  /** U živého přenosu jednou sbalí chat nativním tlačítkem (když ho uživatel znovu otevře, nechá ho). */
  async function hideLiveChat() {
    const t = settings.theater;
    if (!t.enabled || !t.hideLiveChat || page.pageType !== 'watch' || !page.videoId) return;
    const videoId = page.videoId;
    if (chatDoneFor === videoId) return;
    const expanded = await waitFor(
      () => (page.videoId !== videoId ? 'gone' : flexy()?.hasAttribute(YT.liveChatExpandedAttr) ? 'expanded' : null),
      { timeout: 15000 },
    );
    if (expanded !== 'expanded' || page.videoId !== videoId) return; // není živý přenos s chatem
    chatDoneFor = videoId;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (page.videoId !== videoId || !flexy()?.hasAttribute(YT.liveChatExpandedAttr)) return;
      q('liveChatToggle')?.click();
      await sleep(1200);
    }
  }

  /** Klávesové zkratky (chrome.commands → service worker → tato karta). */
  function onCommand(command) {
    if (command === 'toggle-theater') {
      if (page.pageType !== 'watch' || document.fullscreenElement) return;
      q('sizeButton', q('player') ?? document)?.click();
    } else if (command === 'toggle-masthead') {
      if (!root.hasAttribute('ytk-in-theater') || !settings.theater.hideMasthead) return;
      pinned = !root.hasAttribute('ytk-masthead-visible');
      setMastheadVisible(pinned);
    }
  }

  return {
    onCommand,
    onSettings(next) {
      const before = settings.theater;
      settings = next;
      const t = next.theater;
      const autoNow = t.enabled && t.autoTheater;
      const autoBefore = before.enabled && before.autoTheater;
      if (autoNow && !autoBefore) {
        autoDoneFor = null; // právě zapnuto → přepnout do kina i aktuální video
      } else if (!t.enabled && before.enabled && page.pageType === 'watch') {
        // Modul vypnutý → vrátit aktuální video z kina do běžného zobrazení.
        if (flexy()?.hasAttribute(YT.theaterAttr) && !document.fullscreenElement) q('sizeButton', q('player') ?? document)?.click();
      }
      update();
      autoTheater();
      if (next.theater.hideLiveChat && !before.hideLiveChat) hideLiveChat();
    },
    onNavigate(info) {
      page = info;
      update();
      if (info.pageType === 'watch') {
        waitFor(() => (page.videoId === info.videoId ? flexy() : true), { timeout: 15000 }).then(update);
        autoTheater();
        hideLiveChat();
      }
    },
  };
}
