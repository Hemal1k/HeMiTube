/**
 * Modul 2: zobrazení počtu dislajků (jen čtení z Return YouTube Dislike API přes service worker).
 * Postup převzatý z RYD: text se vloží do tlačítka „Nelíbí se mi“ a tlačítko se přepne
 * z varianty „jen ikona“ na „ikona + text“, aby vypadalo jako tlačítko „Líbí se mi“.
 */
import { q, qAll, YT } from '../shared/selectors.js';
import { debounce, formatCount } from '../shared/utils.js';
import { t } from '../shared/i18n.js';

const TEXT_CLASS = 'ytk-dislike-text';
const SYNTHETIC_CLASS = 'ytk-shorts-dislike';
const SWAPPED_ATTR = 'data-ytk-swapped';
const ORIGINAL_ATTR = 'data-ytk-orig';
const BAR_ID = 'ytk-ratio-bar';
const BAR_HOST_CLASS = 'ytk-ratio-host';

function pageLocale() {
  return document.documentElement.lang || navigator.language || undefined;
}

function removeRendered() {
  for (const element of document.querySelectorAll(`.${TEXT_CLASS}`)) element.remove();
  for (const button of document.querySelectorAll(`[${SWAPPED_ATTR}]`)) {
    const pair = YT.iconClassPairs[Number(button.getAttribute(SWAPPED_ATTR))];
    if (pair) button.classList.replace(pair[1], pair[0]);
    button.removeAttribute(SWAPPED_ATTR);
  }
  for (const label of document.querySelectorAll(`[${ORIGINAL_ATTR}]`)) {
    label.textContent = label.getAttribute(ORIGINAL_ATTR);
    label.removeAttribute(ORIGINAL_ATTR);
  }
  for (const element of document.querySelectorAll(`.${SYNTHETIC_CLASS}`)) element.remove();
  document.getElementById(BAR_ID)?.remove();
  for (const host of document.querySelectorAll(`.${BAR_HOST_CLASS}`)) host.classList.remove(BAR_HOST_CLASS);
}

/** Aktivní Short: atribut is-active, jinak renderer, přes který vede vodorovná osa uprostřed okna. */
function activeShortsRenderer() {
  const renderers = qAll('shortsRenderer');
  const flagged = renderers.find((renderer) => renderer.hasAttribute('is-active'));
  if (flagged) return flagged;
  const middle = window.innerHeight / 2;
  return (
    renderers.find((renderer) => {
      const rect = renderer.getBoundingClientRect();
      return rect.width > 0 && rect.top <= middle && rect.bottom >= middle;
    }) ?? null
  );
}

/** Ikona palce dolů (Material Symbols „thumb_down“, Apache 2.0), barva podle textu. */
function thumbDownIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm0 12-4.34 4.34L12 14H3v-2l3-7h9v10zm4-12h4v12h-4z',
  );
  svg.appendChild(path);
  return svg;
}

/**
 * Nový layout Shorts nemá tlačítko „Nelíbí se“. Vyrobíme jen zobrazovací prvek (bez kliknutí)
 * se stejnými třídami jako tlačítko „Líbí se“, aby ladil s ostatními tlačítky v liště.
 */
function createSyntheticShortsDislike(likeHost) {
  const likeLabelHost = q('shortsButtonWithLabel', likeHost);
  const likeButton = q('buttonShape', likeHost);
  const likeLabelBox = q('shortsButtonLabelBox', likeHost);
  const likeLabel = q('shortsButtonLabel', likeHost);
  const iconBox = likeButton?.querySelector('[class*="Icon"], [class*="icon"]');

  const wrapper = document.createElement('div');
  wrapper.className = `${SYNTHETIC_CLASS} ${[...likeHost.classList].filter((name) => /ActionButton/.test(name)).join(' ')}`;
  const labelHost = document.createElement('div');
  labelHost.className = likeLabelHost?.className ?? '';
  const button = document.createElement('div');
  button.className = (likeButton?.className ?? '').replace(/\S*Toggled\S*/g, '');
  button.setAttribute('role', 'img');
  const icon = document.createElement('div');
  icon.className = iconBox?.className ?? '';
  icon.appendChild(thumbDownIcon());
  button.appendChild(icon);
  const labelBox = document.createElement('div');
  labelBox.className = likeLabelBox?.className ?? '';
  const label = document.createElement('span');
  label.className = `${likeLabel?.className ?? ''} ${TEXT_CLASS}`;
  label.setAttribute('role', 'text');
  labelBox.appendChild(label);
  labelHost.append(button, labelBox);
  wrapper.appendChild(labelHost);
  return { wrapper, button, label };
}

/**
 * Záloha, když se změní třídy popisku na Shorts: popisek je textový prvek uvnitř hostitele
 * tlačítka, ale mimo samotný <button> (pod ikonou). Bere se poslední takový.
 */
function findShortsLabel(host) {
  if (!host) return null;
  const candidates = [...host.querySelectorAll('span, div')].filter(
    (element) =>
      element.childElementCount === 0 &&
      !element.closest('button') &&
      (element.textContent.trim() !== '' || element.hasAttribute(ORIGINAL_ATTR)),
  );
  return candidates.at(-1) ?? null;
}

export function initDislikes(ctx) {
  if (!ctx.isTop || location.hostname !== 'www.youtube.com') return null;

  let settings = ctx.getSettings();
  let page = { pageType: 'other', videoId: null };
  let data = null; // { videoId, likes, dislikes } | { videoId, error: true }
  let generation = 0;
  let observer = null;
  let observedRoot = null;
  let interval = null;

  const active = () =>
    settings.dislikes.enabled && (page.pageType === 'watch' || page.pageType === 'shorts') && Boolean(page.videoId);

  function findTargets() {
    if (page.pageType === 'watch') {
      const flexy = q('watchFlexy');
      const flexyVideo = flexy?.getAttribute(YT.videoIdAttr);
      if (flexyVideo && flexyVideo !== page.videoId) return null; // DOM ještě patří předchozímu videu
      const actions = q('watchActions', flexy ?? document);
      const host = q('dislikeButtonHost', actions);
      const button = q('buttonShape', host);
      if (!button) return null;
      const likeText = q('buttonText', q('likeButtonHost', actions));
      return { mode: 'watch', root: actions, host, button, likeText, segmented: q('segmentedLikeDislike', actions) };
    }
    const root = activeShortsRenderer();
    const bar = q('shortsActionBar', root);
    if (!bar) return null;
    const host = q('dislikeButtonHost', bar);
    if (host) {
      // Starší layout s nativním tlačítkem „Nelíbí se“: přepíšeme jeho popisek.
      const label = q('shortsButtonLabel', host) ?? findShortsLabel(host);
      return label ? { mode: 'shorts', root: bar, label } : null;
    }
    const likeHost = q('likeButtonHost', bar);
    return likeHost ? { mode: 'shorts-synthetic', root: bar, likeHost } : null;
  }

  function renderWatch(target, text) {
    let span = target.button.querySelector(`.${TEXT_CLASS}`);
    if (!span) {
      span = document.createElement('div');
      // Stejné třídy jako text u „Líbí se“ → stejné písmo a odsazení, ať YouTube používá jakékoli schéma.
      const likeClasses = [...(target.likeText?.classList ?? [])].filter((name) => !name.startsWith('ytk-'));
      span.className = `${likeClasses.length ? likeClasses.join(' ') : YT.buttonTextClasses} ${TEXT_CLASS}`;
      const feedback = q('touchFeedback', target.button);
      if (feedback?.parentElement === target.button) target.button.insertBefore(span, feedback);
      else target.button.appendChild(span);
    }
    if (span.textContent !== text) span.textContent = text;
    YT.iconClassPairs.forEach(([iconOnly, iconLeading], index) => {
      if (!target.button.classList.contains(iconOnly)) return;
      target.button.classList.replace(iconOnly, iconLeading);
      target.button.setAttribute(SWAPPED_ATTR, String(index));
    });
    renderBar(target);
  }

  function renderBar(target) {
    const existing = document.getElementById(BAR_ID);
    const total = data && !data.error ? data.likes + data.dislikes : 0;
    if (!settings.dislikes.ratioBar || total <= 0) {
      existing?.remove();
      return;
    }
    const host = target.segmented ?? target.host.parentElement;
    if (!host) return;
    let bar = existing;
    if (!bar || bar.parentElement !== host) {
      bar?.remove();
      bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.appendChild(document.createElement('div'));
      host.classList.add(BAR_HOST_CLASS);
      host.appendChild(bar);
    }
    const likePercent = (data.likes / total) * 100;
    const width = `${likePercent.toFixed(2)}%`;
    if (bar.firstChild.style.width !== width) bar.firstChild.style.width = width;
    const locale = pageLocale();
    const title = t('ratioTooltip', [
      formatCount(data.likes, locale),
      formatCount(data.dislikes, locale),
      likePercent.toFixed(1),
    ]);
    if (bar.title !== title) bar.title = title;
  }

  function renderShortsSynthetic(target, text) {
    let wrapper = target.likeHost.nextElementSibling;
    if (!wrapper?.classList.contains(SYNTHETIC_CLASS)) {
      for (const stale of target.root.querySelectorAll(`.${SYNTHETIC_CLASS}`)) stale.remove();
      wrapper = createSyntheticShortsDislike(target.likeHost).wrapper;
      target.likeHost.after(wrapper);
    }
    const label = wrapper.querySelector(`.${TEXT_CLASS}`);
    if (label.textContent !== text) label.textContent = text;
    const aria = t('dislikeCount', [text]);
    const button = wrapper.querySelector('[role="img"]');
    if (button.getAttribute('aria-label') !== aria) {
      button.setAttribute('aria-label', aria);
      button.title = aria;
    }
  }

  function renderShorts(target, text) {
    if (!target.label.hasAttribute(ORIGINAL_ATTR)) target.label.setAttribute(ORIGINAL_ATTR, target.label.textContent);
    if (target.label.textContent !== text) target.label.textContent = text;
  }

  function render() {
    if (!active() || !data || data.videoId !== page.videoId) return;
    const target = findTargets();
    if (!target) return;
    const text = data.error ? '–' : formatCount(data.dislikes, pageLocale());
    if (target.mode === 'watch') renderWatch(target, text);
    else if (target.mode === 'shorts-synthetic') renderShortsSynthetic(target, text);
    else renderShorts(target, text);
    observe(target.root);
  }

  const scheduleRender = debounce(render, 100);

  function observe(root) {
    if (!root || root === observedRoot) return;
    observer?.disconnect();
    observedRoot = root;
    observer = new MutationObserver(scheduleRender);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    observedRoot = null;
    clearInterval(interval);
    interval = null;
    scheduleRender.cancel();
    removeRendered();
  }

  async function load() {
    const current = ++generation;
    stop();
    data = null;
    if (!active()) return;
    const videoId = page.videoId;
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'ryd:get', videoId });
    } catch {
      response = null;
    }
    if (current !== generation) return;
    data =
      response?.ok && Number.isFinite(response.dislikes)
        ? { videoId, likes: response.likes, dislikes: response.dislikes }
        : { videoId, error: true };
    render();
    // Pojistka pro pozdní načtení a překreslení tlačítek, které observer nezachytí:
    // prvních 15 s každou sekundu, pak už jen každých 5 s.
    let ticks = 0;
    interval = setInterval(() => {
      render();
      if (++ticks === 15) {
        clearInterval(interval);
        interval = setInterval(render, 5000);
      }
    }, 1000);
  }

  return {
    onSettings(next) {
      const before = settings.dislikes;
      settings = next;
      if (before.enabled !== next.dislikes.enabled) load();
      else render();
    },
    onNavigate(info) {
      const changed = info.videoId !== page.videoId || info.pageType !== page.pageType;
      page = info;
      if (changed) load();
    },
  };
}
