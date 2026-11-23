/** Popup: dlaždice rychlého nastavení, kvalita, rychlost a kodeky, stav přehrávání na aktivní kartě. */
import { localizePage, t } from '../shared/i18n.js';
import { loadSettings, saveSettings, watchSettings } from '../shared/storage.js';
import { FPS_OPTIONS, QUALITY_OPTIONS, SPEED_OPTIONS } from '../shared/settings.js';
import { SB_ORIGIN } from '../shared/sponsorblock.js';
import { AUDIO_CODECS, VIDEO_CODECS } from '../shared/codec-logic.js';

const CODEC_NAMES = { av1: 'AV1', vp9: 'VP9', vp8: 'VP8', h264: 'H.264', opus: 'Opus', aac: 'AAC' };
const $ = (id) => document.getElementById(id);

let settings = null;
let tabId = null;

function openOptions(event) {
  event?.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
}

async function save() {
  try {
    settings = await saveSettings(settings);
  } catch {
    settings = await loadSettings(); // neuloženo → ukázat skutečný stav
    $('sb-message').textContent = t('saveFailed');
  }
  render();
  // Content script po změně přepočítá konfiguraci kodeků (chytrý výběr je asynchronní).
  setTimeout(refreshStatus, 400);
}

/* ---------- Kvalita, FPS a rychlost ---------- */

function qualityLabel(value) {
  if (value === 'max') return t('qualityMax');
  if (value === 'screen') return t('qualityScreen');
  return `${value}p`;
}

const speedLabel = (value) => `${Number(value).toLocaleString(document.documentElement.lang || undefined)}×`;

function fillSpeed() {
  const select = $('playback-speed');
  for (const value of SPEED_OPTIONS) select.add(new Option(speedLabel(value), value));
  select.addEventListener('change', () => {
    settings.playback.speed = select.value;
    save();
  });
}

function fillQuality() {
  const select = $('quality-preferred');
  for (const value of QUALITY_OPTIONS) select.add(new Option(qualityLabel(value), value));
  select.addEventListener('change', () => {
    settings.quality.preferred = select.value;
    save();
  });
  const fps = $('quality-fps');
  for (const value of FPS_OPTIONS) fps.add(new Option(t(`fps_${value}`), value));
  fps.addEventListener('change', () => {
    settings.quality.fps = fps.value;
    save();
  });
}

/* ---------- Režim kina ---------- */

// Jeden přepínač: zapnuto = modul kina + automatické spouštění (každé video v režimu kina přes celou
// stránku), vypnuto = obojí vypnuté. Podrobné volby zůstávají v pokročilých nastaveních.
function bindTheater() {
  $('theater-toggle').addEventListener('change', () => {
    const on = $('theater-toggle').checked;
    settings.theater.enabled = on;
    settings.theater.autoTheater = on;
    save();
  });
}

/* ---------- Kodeky (video a audio zvlášť) ---------- */

function createChip(codec, enabled, rankNumber, onClick) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.dataset.codec = codec;
  chip.setAttribute('aria-pressed', String(enabled));
  chip.title = t(enabled ? 'codecChipOn' : 'codecChipOff', [CODEC_NAMES[codec]]);
  if (rankNumber) {
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${rankNumber}.`;
    chip.appendChild(rank);
  }
  chip.appendChild(document.createTextNode(CODEC_NAMES[codec]));
  chip.addEventListener('click', onClick);
  return chip;
}

function renderCodecChips() {
  // Video: pořadí podle priority (číslo), audio: pevné pořadí.
  $('codec-chips').replaceChildren(
    ...settings.codecs.order
      .filter((codec) => VIDEO_CODECS.includes(codec))
      .map((codec, index) =>
        createChip(codec, !settings.codecs.disabled.includes(codec), index + 1, () => toggleCodec('disabled', VIDEO_CODECS, codec)),
      ),
  );
  $('audio-chips').replaceChildren(
    ...AUDIO_CODECS.map((codec) =>
      createChip(codec, !settings.codecs.audioDisabled.includes(codec), 0, () => toggleCodec('audioDisabled', AUDIO_CODECS, codec)),
    ),
  );
}

/** key = 'disabled' (video) | 'audioDisabled'; aspoň jeden kodek ze skupiny musí zůstat zapnutý. */
function toggleCodec(key, group, codec) {
  const disabled = new Set(settings.codecs[key]);
  if (disabled.has(codec)) disabled.delete(codec);
  else disabled.add(codec);
  if (group.every((c) => disabled.has(c))) {
    $('codec-message').textContent = t(group === VIDEO_CODECS ? 'needOneVideoCodec' : 'needOneAudioCodec');
    return;
  }
  $('codec-message').textContent = '';
  settings.codecs[key] = [...disabled];
  save();
}

/* ---------- Vykreslení ---------- */

function render() {
  for (const input of document.querySelectorAll('input[data-module]')) {
    input.checked = settings[input.dataset.module].enabled;
  }
  for (const sub of document.querySelectorAll('[data-sub]')) sub.hidden = !settings[sub.dataset.sub].enabled;
  $('quality-preferred').value = settings.quality.preferred;
  $('quality-fps').value = settings.quality.fps;
  $('playback-speed').value = settings.playback.speed;
  $('theater-toggle').checked = settings.theater.enabled && settings.theater.autoTheater;
  // Dlaždice: text stavu (Zapnuto / Vypnuto) – až po nastavení všech přepínačů.
  for (const tile of document.querySelectorAll('.tile')) {
    tile.querySelector('.tile-state').textContent = t(tile.querySelector('input').checked ? 'stateOn' : 'stateOff');
  }
  renderCodecChips();
}

function renderStatus(status) {
  const has = Boolean(status?.ok);
  $('status-empty').hidden = has;
  $('status-list').hidden = !has;
  $('reload-notice').hidden = !(has && status.reloadNeeded);
  if (!has) return;
  const codecs = [status.videoCodec, status.audioCodec].filter(Boolean).map((codec) => CODEC_NAMES[codec] ?? codec);
  $('status-codec').textContent = codecs.length ? codecs.join(' + ') : '–';
  $('status-codec').title = [status.videoMime, status.audioMime].filter(Boolean).join('\n');
  $('status-resolution').textContent = status.width && status.height ? `${status.width} × ${status.height}` : '–';
  $('status-fps').textContent = status.fps ? t('fpsValue', [String(status.fps)]) : '–';
  $('status-quality').textContent = status.quality ?? '–';
}

async function refreshStatus() {
  if (tabId === null) return renderStatus(null);
  try {
    renderStatus(await chrome.tabs.sendMessage(tabId, { type: 'ytk:getStatus' }));
  } catch {
    renderStatus(null); // na kartě neběží náš content script (není to YouTube) nebo tam není video
  }
}

async function init() {
  localizePage();
  fillQuality();
  fillSpeed();
  bindTheater();
  settings = await loadSettings();
  render();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;

  for (const input of document.querySelectorAll('input[data-module]')) {
    input.addEventListener('change', async () => {
      const module = input.dataset.module;
      // SponsorBlock potřebuje volitelné oprávnění k sponsor.ajay.app. Žádost musí přijít hned z kliknutí;
      // zapnutí se uloží současně, protože dialog oprávnění může popup zavřít dřív, než se vrátí odpověď.
      if (module === 'sponsorBlock' && input.checked) {
        settings.sponsorBlock.enabled = true;
        const [granted] = await Promise.all([chrome.permissions.request({ origins: [SB_ORIGIN] }).catch(() => false), save()]);
        if (!granted) {
          settings.sponsorBlock.enabled = false;
          $('sb-message').textContent = t('sbPermissionDenied');
          await save();
        }
        return;
      }
      $('sb-message').textContent = '';
      settings[module].enabled = input.checked;
      save();
    });
  }
  $('open-options').addEventListener('click', openOptions);
  $('reload-tab').addEventListener('click', async () => {
    if (tabId !== null) await chrome.tabs.reload(tabId);
    window.close();
  });
  watchSettings((next) => {
    settings = next;
    render();
  });

  await refreshStatus();
  setInterval(refreshStatus, 2000);
}

init();
