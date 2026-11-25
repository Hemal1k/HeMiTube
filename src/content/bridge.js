/**
 * Most mezi izolovaným světem a MAIN worldem + předávání nastavení kodeků.
 *
 * MAIN world si nastavení kodeků čte synchronně z localStorage stránky při document_start.
 * Tady ho po každé změně nastavení přepočítáme a zapíšeme.
 * Porovnáním s konfigurací, kterou MAIN world skutečně načetl, poznáme, že je potřeba obnovit kartu.
 */
import { createIsolatedEndpoint } from '../shared/bridge-protocol.js';
import { CODEC_STORAGE_KEY, buildCodecConfig, codecConfigKey, isCodecConfigActive } from '../shared/codec-logic.js';

const MIME_MAX = 300;
const cleanMime = (value) => (typeof value === 'string' && value.length <= MIME_MAX ? value : null);

export function createBridge() {
  const endpoint = createIsolatedEndpoint();
  const codecState = { video: null, audio: null };
  let loadedKey = null; // konfigurace, kterou MAIN world načetl při startu stránky
  let currentKey = null; // konfigurace podle aktuálního nastavení

  endpoint.on('codec', (data) => {
    if (!data || typeof data !== 'object') return;
    codecState.video = cleanMime(data.video) ?? codecState.video;
    codecState.audio = cleanMime(data.audio) ?? codecState.audio;
  });

  endpoint
    .call('getCodecState', {}, 5000)
    .then((state) => {
      if (!state || typeof state !== 'object') return;
      if (typeof state.loadedKey === 'string' && state.loadedKey.length < 500) loadedKey = state.loadedKey;
      codecState.video = cleanMime(state.video) ?? codecState.video;
      codecState.audio = cleanMime(state.audio) ?? codecState.audio;
    })
    .catch(() => {});

  function writeConfig(cfg) {
    currentKey = codecConfigKey(cfg);
    try {
      if (isCodecConfigActive(cfg)) localStorage.setItem(CODEC_STORAGE_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CODEC_STORAGE_KEY);
    } catch {
      // localStorage může být zakázané (nastavení cookies); kodeky pak zůstanou bez omezení.
    }
  }

  function onSettings(settings) {
    writeConfig(buildCodecConfig(settings));
  }

  return {
    call: endpoint.call,
    on: endpoint.on,
    ready: endpoint.ready,
    onSettings,
    getCodecState: () => ({ ...codecState }),
    isReloadNeeded: () => loadedKey !== null && currentKey !== null && loadedKey !== currentKey,
  };
}
