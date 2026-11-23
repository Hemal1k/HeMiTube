/**
 * Vstupní bod MAIN worldu (manifest: world "MAIN", run_at "document_start", all_frames).
 * Pořadí je důležité: háčky na kodeky se musí nainstalovat dřív, než se spustí skripty YouTube.
 */
import { installCodecHooks, readCodecConfig } from './codecs.js';
import { applyPlaybackRate, applyQuality, getPlayerInfo } from './player-api.js';
import { createMainEndpoint } from '../shared/bridge-protocol.js';
import { codecConfigKey } from '../shared/codec-logic.js';

function main() {
  // Jen horní rámec a vložený přehrávač (/embed/); v ostatních iframech nic.
  if (window.top !== window && !location.pathname.startsWith('/embed/')) return;

  const codecConfig = readCodecConfig();
  const codecState = { video: null, audio: null };
  let endpoint = null;

  installCodecHooks(codecConfig, (mime) => {
    if (mime.startsWith('video/')) codecState.video = mime;
    else if (mime.startsWith('audio/')) codecState.audio = mime;
    else return;
    endpoint?.notify('codec', { ...codecState });
  });

  endpoint = createMainEndpoint({
    applyQuality,
    applyPlaybackRate,
    getPlayerInfo,
    getCodecState: () => ({ ...codecState, loadedKey: codecConfigKey(codecConfig) }),
  });
}

main();
