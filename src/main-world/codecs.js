/**
 * Blokování kodeků (MAIN world, document_start, před skripty YouTube).
 *
 * YouTube si kodek vybírá sám podle toho, co prohlížeč hlásí jako podporované.
 * Vypnuté kodeky proto hlásíme jako nepodporované ve třech API:
 * MediaSource.isTypeSupported, HTMLMediaElement.prototype.canPlayType a
 * navigator.mediaCapabilities.decodingInfo (enhanced-h264ify obaluje jen první dvě).
 *
 * Nastavení se čte synchronně z localStorage (zapisuje ho content/bridge.js).
 * Změna se proto projeví až po obnovení stránky.
 */
import { CODEC_STORAGE_KEY, isBlocked, isDecodingConfigBlocked, parseCodecConfig } from '../shared/codec-logic.js';

export function readCodecConfig() {
  try {
    return parseCodecConfig(localStorage.getItem(CODEC_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Nahradí metodu obalem a zachová její name/length i výstup toString(). */
function wrapMethod(owner, name, makeWrapper) {
  if (!owner) return;
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  const original = descriptor?.value;
  if (typeof original !== 'function') return;
  const wrapped = makeWrapper(original);
  Object.defineProperty(wrapped, 'name', { value: original.name });
  Object.defineProperty(wrapped, 'length', { value: original.length });
  Object.defineProperty(wrapped, 'toString', { value: () => Function.prototype.toString.call(original) });
  Object.defineProperty(owner, name, { ...descriptor, value: wrapped });
}

/**
 * cfg: { blocked: string[], cap30: boolean } | null
 * onSourceBuffer(mime): volá se pro každý vytvořený SourceBuffer (stav pro popup).
 */
export function installCodecHooks(cfg, onSourceBuffer) {
  const active = Boolean(cfg && (cfg.blocked.length > 0 || cfg.cap30));

  if (active) {
    const typeChecker = (original, unsupported) =>
      function (type) {
        if (isBlocked(String(type), cfg)) return unsupported;
        return original.apply(this, arguments);
      };

    if (window.MediaSource) wrapMethod(window.MediaSource, 'isTypeSupported', (original) => typeChecker(original, false));
    if (window.ManagedMediaSource) {
      wrapMethod(window.ManagedMediaSource, 'isTypeSupported', (original) => typeChecker(original, false));
    }
    wrapMethod(HTMLMediaElement.prototype, 'canPlayType', (original) => typeChecker(original, ''));

    if (window.MediaCapabilities) {
      wrapMethod(
        window.MediaCapabilities.prototype,
        'decodingInfo',
        (original) =>
          function (configuration) {
            try {
              if (isDecodingConfigBlocked(configuration, cfg)) {
                return Promise.resolve({ supported: false, smooth: false, powerEfficient: false, configuration });
              }
            } catch {
              // Nečekaný tvar konfigurace: necháme rozhodnout prohlížeč.
            }
            return original.apply(this, arguments);
          },
      );
    }
  }

  if (window.MediaSource) {
    wrapMethod(
      window.MediaSource.prototype,
      'addSourceBuffer',
      (original) =>
        function (type) {
          try {
            onSourceBuffer(String(type));
          } catch {
            // Hlášení stavu nesmí rozbít přehrávání.
          }
          return original.apply(this, arguments);
        },
    );
  }
}
