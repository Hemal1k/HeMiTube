/**
 * Volitelně: zabalí dist/ do release/hemitube-<verze>.crx přes balíček crx3.
 * Soukromý klíč leží MIMO projekt: %USERPROFILE%\.hemitube\key.pem (jinou cestu lze zadat proměnnou
 * HEMITUBE_KEY). Když neexistuje, crx3 ho vytvoří. Starý key.pem z kořene projektu se jednou zkopíruje,
 * ať zůstane stejné ID rozšíření. Klíč si zálohuj: určuje ID rozšíření.
 *
 * Pozn.: Chrome od verze 75 instaluje .crx mimo Chrome Web Store jen v režimu pro vývojáře
 * (chyba CRX_REQUIRED_PROOF_MISSING). Pro běžné použití je jednodušší „Načíst rozbalené“.
 */
import crx3 from 'crx3';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const RELEASE = join(ROOT, 'release');
const KEY = process.env.HEMITUBE_KEY || join(homedir(), '.hemitube', 'key.pem');
const LEGACY_KEY = join(ROOT, 'key.pem');
mkdirSync(dirname(KEY), { recursive: true });
if (!existsSync(KEY) && existsSync(LEGACY_KEY)) {
  copyFileSync(LEGACY_KEY, KEY);
  console.log(`Klíč zkopírován do ${KEY}. Původní ${relative(ROOT, LEGACY_KEY)} můžeš z projektu smazat.`);
}

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/ neexistuje – nejdřív spusť npm run build.');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
mkdirSync(RELEASE, { recursive: true });
const crxPath = join(RELEASE, `hemitube-${version}.crx`);
const hadKey = existsSync(KEY);

await crx3([join(DIST, 'manifest.json')], { keyPath: KEY, crxPath });
console.log(relative(ROOT, crxPath));
console.log(hadKey ? `Použit klíč ${KEY}.` : `Vytvořen nový klíč ${KEY} – zálohuj ho.`);
