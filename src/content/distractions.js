/**
 * Modul: skrytí rozptýlení (každá položka volitelná, výchozí vše vypnuto):
 * závěrečné obrazovky, informační karty, doporučená videa, doporučení na hlavní stránce,
 * a komentáře (chat u živých přenosů řeší volba v Režimu kina). CSS se sestaví z DISTRACTION_SELECTORS a platí jen při atributu
 * ytk-hide-<položka> na <html>, takže změna nastavení je okamžitá.
 */
import { DISTRACTION_SELECTORS } from '../shared/selectors.js';
import { toggleAttr } from '../shared/utils.js';

const attrOf = (key) => `ytk-hide-${key.toLowerCase()}`;

function buildStyle() {
  const rules = Object.entries(DISTRACTION_SELECTORS).flatMap(([key, selectors]) =>
    selectors.map((selector) => `html[${attrOf(key)}] ${selector} { display: none !important; }`),
  );
  const style = document.createElement('style');
  style.id = 'ytk-distractions-style';
  style.textContent = rules.join('\n');
  return style;
}

export function initDistractions(ctx) {
  if (!ctx.isTop && !location.pathname.startsWith('/embed/')) return null;
  const root = document.documentElement;
  root.appendChild(buildStyle());

  function update(settings) {
    for (const key of Object.keys(DISTRACTION_SELECTORS)) toggleAttr(root, attrOf(key), Boolean(settings.distractions[key]));
  }

  update(ctx.getSettings());
  return { onSettings: update };
}
