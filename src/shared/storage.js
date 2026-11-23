/** Načítání a ukládání nastavení v chrome.storage.sync. */
import { SETTINGS_KEY, migrate } from './settings.js';

export async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    return migrate(result[SETTINGS_KEY]);
  } catch {
    return migrate(null);
  }
}

export async function saveSettings(settings) {
  const clean = migrate(settings);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: clean });
  return clean;
}

/** Zavolá `callback(settings)` při každé změně nastavení (i z jiné karty nebo zařízení). */
export function watchSettings(callback) {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[SETTINGS_KEY]) callback(migrate(changes[SETTINGS_KEY].newValue));
    });
  } catch {
    // Kontext rozšíření byl zneplatněn (rozšíření se přeinstalovalo); stránka si to vyřeší po obnovení.
  }
}
