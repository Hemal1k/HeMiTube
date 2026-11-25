/** Překlady přes chrome.i18n (_locales/cs, _locales/en). Chybějící klíč vrátí sám sebe, ať je chyba vidět. */
export function t(key, substitutions) {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch {
    return key;
  }
}

/** Popisek volby kvality: „Nejvyšší dostupná“, „Podle obrazovky“, „1080p“. */
export function qualityLabel(value) {
  if (value === 'max') return t('qualityMax');
  if (value === 'screen') return t('qualityScreen');
  return `${value}p`;
}

/** Popisek rychlosti podle jazyka stránky: „1,25×“ (cs), „1.25×“ (en). */
export const speedLabel = (value) => `${Number(value).toLocaleString(document.documentElement.lang || undefined)}×`;

/** Přeloží prvky s atributy data-i18n (text), data-i18n-title, data-i18n-aria-label. */
export function localizePage(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
  for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }
  const lang = t('@@ui_locale');
  if (lang && lang !== '@@ui_locale') document.documentElement.lang = lang.replace('_', '-');
}
