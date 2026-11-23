/** Stránka nastavení: všechny volby, pořadí kodeků (drag & drop + šipky), export/import, výchozí. */
import { localizePage, t } from '../shared/i18n.js';
import { loadSettings, saveSettings, watchSettings } from '../shared/storage.js';
import {
  FPS_OPTIONS,
  QUALITY_OPTIONS,
  REVEAL_OPTIONS,
  SB_CATEGORIES,
  SPEED_OPTIONS,
  defaultSettings,
  getPath,
  migrate,
  setPath,
} from '../shared/settings.js';
import { AUDIO_CODECS, VIDEO_CODECS, buildCodecConfig, codecConfigKey } from '../shared/codec-logic.js';
import { SB_ORIGIN } from '../shared/sponsorblock.js';

const CODEC_NAMES = { av1: 'AV1', vp9: 'VP9', h264: 'H.264' };
let settings = null;
let toastTimer = null;
let savedCodecKey = null; // konfigurace kodeků/FPS při posledním uložení

/** Krátká zpráva dole. info = upozornění (žluté, déle viditelné), např. že je potřeba obnovit stránku. */
function toast(message, { info = false } = {}) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.toggle('info', info);
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), info ? 4500 : 1800);
}

const codecKeyOf = (value) => codecConfigKey(buildCodecConfig(value));

function qualityLabel(value) {
  if (value === 'max') return t('qualityMax');
  if (value === 'screen') return t('qualityScreen');
  return `${value}p`;
}

const speedLabel = (value) => `${Number(value).toLocaleString(document.documentElement.lang || undefined)}×`;

const OPTION_SETS = {
  quality: () => QUALITY_OPTIONS.map((value) => [value, qualityLabel(value)]),
  qualityOptional: () => [['', t('qualitySameAsMain')], ...QUALITY_OPTIONS.map((value) => [value, qualityLabel(value)])],
  reveal: () => REVEAL_OPTIONS.map((value) => [value, t(`reveal_${value}`)]),
  fps: () => FPS_OPTIONS.map((value) => [value, t(`fps_${value}`)]),
  speed: () => SPEED_OPTIONS.map((value) => [value, speedLabel(value)]),
};

function fillSelects() {
  for (const select of document.querySelectorAll('select[data-options]')) {
    for (const [value, label] of OPTION_SETS[select.dataset.options]()) select.add(new Option(label, value));
  }
}

async function save(message = t('saved')) {
  // Stav před uložením si vzít hned: vlastní zápis vyvolá watchSettings dřív, než se await vrátí.
  const before = savedCodecKey;
  try {
    settings = await saveSettings(settings);
  } catch {
    settings = await loadSettings(); // neuloženo → ukázat skutečný stav
    render();
    toast(t('saveFailed'), { info: true });
    return;
  }
  render();
  // Kodeky a omezení FPS se do stránky dostanou jen při jejím načtení → upozornit na obnovení.
  const key = codecKeyOf(settings);
  const needsReload = before !== null && key !== before;
  savedCodecKey = key;
  if (needsReload) toast(t('savedReload'), { info: true });
  else toast(message);
}

/* ---------- Kodeky ---------- */

function moveCodec(codec, delta) {
  const order = settings.codecs.order;
  const from = order.indexOf(codec);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(to, 0, order.splice(from, 1)[0]);
  save();
}

function toggleCodec(codec, enabled, input) {
  const disabled = new Set(settings.codecs.disabled);
  if (enabled) disabled.delete(codec);
  else disabled.add(codec);
  if (VIDEO_CODECS.every((c) => disabled.has(c))) {
    input.checked = true;
    toast(t('needOneVideoCodec'));
    return;
  }
  settings.codecs.disabled = [...disabled];
  save();
}

let dragged = null;

function renderCodecList() {
  const list = document.getElementById('codec-list');
  list.replaceChildren();
  settings.codecs.order.forEach((codec, index) => {
    const item = document.createElement('li');
    item.draggable = true;
    item.dataset.codec = codec;

    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-hidden', 'true');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${index + 1}.`;

    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !settings.codecs.disabled.includes(codec);
    checkbox.addEventListener('change', () => toggleCodec(codec, checkbox.checked, checkbox));
    label.append(checkbox, document.createTextNode(CODEC_NAMES[codec]));

    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.setAttribute('aria-label', t('moveUp', [CODEC_NAMES[codec]]));
    up.addEventListener('click', () => moveCodec(codec, -1));

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.disabled = index === settings.codecs.order.length - 1;
    down.setAttribute('aria-label', t('moveDown', [CODEC_NAMES[codec]]));
    down.addEventListener('click', () => moveCodec(codec, 1));

    item.append(handle, rank, label, up, down);

    item.addEventListener('dragstart', (event) => {
      dragged = codec;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', codec);
    });
    item.addEventListener('dragend', () => {
      dragged = null;
      item.classList.remove('dragging');
    });
    item.addEventListener('dragover', (event) => {
      if (!dragged || dragged === codec) return;
      event.preventDefault();
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      item.classList.remove('drop-target');
      if (!dragged || dragged === codec) return;
      const order = settings.codecs.order.filter((c) => c !== dragged);
      order.splice(order.indexOf(codec) + (settings.codecs.order.indexOf(dragged) < index ? 1 : 0), 0, dragged);
      settings.codecs.order = order;
      save();
    });

    list.appendChild(item);
  });
}

function bindAudio() {
  for (const input of document.querySelectorAll('input[data-audio]')) {
    input.addEventListener('change', () => {
      const disabled = new Set(settings.codecs.audioDisabled);
      if (input.checked) disabled.delete(input.dataset.audio);
      else disabled.add(input.dataset.audio);
      if (AUDIO_CODECS.every((codec) => disabled.has(codec))) {
        input.checked = true;
        toast(t('needOneAudioCodec'));
        return;
      }
      settings.codecs.audioDisabled = [...disabled];
      save();
    });
  }
}

/* ---------- Obecné vazby data-setting ---------- */

/* ---------- SponsorBlock ---------- */

const hasSbPermission = () => chrome.permissions.contains({ origins: [SB_ORIGIN] }).catch(() => false);

async function renderSbPermission() {
  const missing = settings.sponsorBlock.enabled && !(await hasSbPermission());
  document.getElementById('sb-permission').hidden = !missing;
}

function renderSbCategories() {
  const container = document.getElementById('sb-categories');
  if (!container.childElementCount) {
    for (const category of SB_CATEGORIES) {
      const label = document.createElement('label');
      label.className = 'opt';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.sbCategory = category;
      input.addEventListener('change', () => {
        const set = new Set(settings.sponsorBlock.categories);
        if (input.checked) set.add(category);
        else set.delete(category);
        settings.sponsorBlock.categories = SB_CATEGORIES.filter((c) => set.has(c));
        save();
      });
      const text = document.createElement('span');
      text.textContent = t(`sbCat_${category}`);
      label.append(input, text);
      container.appendChild(label);
    }
  }
  for (const input of container.querySelectorAll('input[data-sb-category]')) {
    input.checked = settings.sponsorBlock.categories.includes(input.dataset.sbCategory);
  }
}

/** Zapnutí SponsorBlocku: nejdřív volitelné oprávnění (žádost musí přijít přímo z kliknutí). */
async function requestSbPermission() {
  const granted = await chrome.permissions.request({ origins: [SB_ORIGIN] }).catch(() => false);
  if (!granted) toast(t('sbPermissionDenied'), { info: true });
  return granted;
}

/* ---------- Klávesové zkratky ---------- */

async function renderShortcuts() {
  const list = document.getElementById('shortcut-list');
  const commands = await chrome.commands.getAll().catch(() => []);
  list.replaceChildren(
    ...commands
      .filter((command) => !command.name.startsWith('_'))
      .map((command) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = command.description;
        const key = document.createElement('kbd');
        key.textContent = command.shortcut || t('shortcutNotSet');
        key.classList.toggle('unset', !command.shortcut);
        item.append(name, key);
        return item;
      }),
  );
}

function bindSettings() {
  for (const element of document.querySelectorAll('[data-setting]')) {
    element.addEventListener('change', async () => {
      const path = element.dataset.setting;
      if (path === 'sponsorBlock.enabled' && element.checked && !(await requestSbPermission())) {
        element.checked = false;
        return;
      }
      let value;
      if (element.type === 'checkbox') value = element.checked;
      else if (element.dataset.options === 'qualityOptional') value = element.value === '' ? null : element.value;
      else value = element.value;
      setPath(settings, path, value);
      save();
    });
  }
}

function render() {
  for (const element of document.querySelectorAll('[data-setting]')) {
    const value = getPath(settings, element.dataset.setting);
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else element.value = value ?? '';
  }
  for (const input of document.querySelectorAll('input[data-audio]')) {
    input.checked = !settings.codecs.audioDisabled.includes(input.dataset.audio);
  }
  // Závislé volby (např. „Kdy lištu ukázat“) jsou aktivní jen se zapnutou nadřazenou volbou.
  for (const element of document.querySelectorAll('[data-depends]')) {
    const enabled = Boolean(getPath(settings, element.dataset.depends));
    element.classList.toggle('inactive', !enabled);
    for (const control of element.querySelectorAll('input, select')) control.disabled = !enabled;
  }
  for (const card of document.querySelectorAll('.card')) {
    const master = card.querySelector('.card-head input[data-setting]');
    card.classList.toggle('disabled', Boolean(master && !master.checked));
  }
  renderCodecList();
  renderSbCategories();
  renderSbPermission();
}

/* ---------- Export / import / výchozí ---------- */

function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hemitube-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importSettings(file) {
  if (!file) return;
  try {
    if (file.size > 100_000) throw new Error('too-large');
    settings = migrate(JSON.parse(await file.text()));
    await save(t('imported'));
  } catch {
    toast(t('importFailed'));
  }
}

async function init() {
  localizePage();
  fillSelects();
  settings = await loadSettings();
  savedCodecKey = codecKeyOf(settings);
  render();
  bindSettings();
  bindAudio();
  document.getElementById('sb-grant').addEventListener('click', async () => {
    if (await requestSbPermission()) renderSbPermission();
  });
  document.getElementById('open-shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  renderShortcuts();
  // Po návratu ze stránky zkratek ukázat aktuální klávesy.
  window.addEventListener('focus', renderShortcuts);

  document.getElementById('export').addEventListener('click', exportSettings);
  const fileInput = document.getElementById('import-file');
  document.getElementById('import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await importSettings(fileInput.files[0]);
    fileInput.value = '';
  });
  document.getElementById('reset').addEventListener('click', async () => {
    if (!confirm(t('resetConfirm'))) return;
    settings = defaultSettings();
    await save(t('resetDone'));
  });

  // Změna z popupu nebo z jiného zařízení se promítne i sem.
  watchSettings((next) => {
    settings = next;
    savedCodecKey = codecKeyOf(next);
    render();
  });
}

init();
