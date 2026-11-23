/**
 * Kontrola sestaveného rozšíření: validní MV3 manifest, povolená oprávnění,
 * existence všech souborů, na které manifest a HTML stránky odkazují, a překladových klíčů.
 * Samostatně: node scripts/verify-dist.mjs (nebo npm run verify)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_PERMISSIONS = ['storage'];
// Volitelné: uživatel je udělí až při zapnutí funkce (SponsorBlock).
const ALLOWED_OPTIONAL_HOSTS = ['https://sponsor.ajay.app/*'];
const ALLOWED_HOSTS = ['https://returnyoutubedislikeapi.com/*'];

function readJson(path, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${path}: neplatný JSON (${error.message})`);
    return null;
  }
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export function verifyDist(dist) {
  const problems = [];
  const manifestPath = join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) return ['chybí manifest.json'];
  const manifest = readJson(manifestPath, problems);
  if (!manifest) return problems;

  const need = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const fileExists = (relative, from = dist) => {
    const path = resolve(from, relative);
    need(path.startsWith(resolve(dist)) && existsSync(path), `odkazovaný soubor neexistuje: ${relative}`);
  };

  need(manifest.manifest_version === 3, 'manifest_version musí být 3');
  need(typeof manifest.name === 'string' && manifest.name.length > 0, 'chybí name');
  need(/^\d+(\.\d+){0,3}$/.test(manifest.version ?? ''), `neplatná version: ${manifest.version}`);
  for (const permission of manifest.permissions ?? []) {
    need(ALLOWED_PERMISSIONS.includes(permission), `nepovolené oprávnění: ${permission}`);
  }
  for (const host of manifest.host_permissions ?? []) {
    need(ALLOWED_HOSTS.includes(host), `nepovolená host_permission: ${host}`);
  }
  for (const host of manifest.optional_host_permissions ?? []) {
    need(ALLOWED_OPTIONAL_HOSTS.includes(host), `nepovolená optional_host_permission: ${host}`);
  }
  need(!manifest.optional_permissions, 'optional_permissions nejsou povolená');
  need(!manifest.content_security_policy, 'vlastní content_security_policy není povolená');
  need(!('background' in manifest) || Boolean(manifest.background.service_worker), 'MV3 background vyžaduje service_worker');
  need(!manifest.background?.scripts, 'background.scripts je MV2');
  need(!manifest.browser_action && !manifest.page_action, 'browser_action/page_action jsou MV2');

  if (manifest.background?.service_worker) fileExists(manifest.background.service_worker);
  if (manifest.action?.default_popup) fileExists(manifest.action.default_popup);
  if (manifest.options_ui?.page) fileExists(manifest.options_ui.page);
  for (const icon of Object.values(manifest.icons ?? {})) fileExists(icon);
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) fileExists(icon);
  for (const script of manifest.content_scripts ?? []) {
    need(Array.isArray(script.matches) && script.matches.length > 0, 'content_scripts bez matches');
    for (const file of [...(script.js ?? []), ...(script.css ?? [])]) fileExists(file);
    need(!script.world || ['MAIN', 'ISOLATED'].includes(script.world), `neplatný world: ${script.world}`);
  }

  // Překlady: default_locale existuje a obsahuje všechny __MSG_klíče__ z manifestu.
  const locales = existsSync(join(dist, '_locales')) ? readdirSync(join(dist, '_locales')) : [];
  need(locales.includes(manifest.default_locale), `chybí _locales/${manifest.default_locale}`);
  const manifestKeys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
  for (const locale of locales) {
    const messages = readJson(join(dist, '_locales', locale, 'messages.json'), problems) ?? {};
    for (const key of manifestKeys) need(key in messages, `_locales/${locale}: chybí klíč ${key}`);
  }

  // HTML stránky: všechny lokální src/href existují; žádné vzdálené skripty ani inline <script>.
  for (const page of listFiles(dist).filter((path) => path.endsWith('.html'))) {
    const html = readFileSync(page, 'utf8');
    for (const match of html.matchAll(/\s(?:src|href)="([^"#][^"]*)"/g)) {
      const reference = match[1];
      if (/^[a-z]+:/i.test(reference)) {
        need(false, `${page}: vzdálený odkaz není povolený: ${reference}`);
        continue;
      }
      fileExists(reference, dirname(page));
    }
    need(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${page}: inline <script> není v MV3 povolený`);
  }

  // Žádný vzdálený kód: v JS nesmí být import()/importScripts z http(s).
  for (const file of listFiles(dist).filter((path) => path.endsWith('.js'))) {
    const code = readFileSync(file, 'utf8');
    need(!/importScripts\s*\(|import\s*\(\s*['"`]https?:/.test(code), `${file}: načítání vzdáleného kódu`);
    need(!/\beval\s*\(|new\s+Function\s*\(/.test(code), `${file}: eval/new Function není povolené`);
  }

  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const problems = verifyDist(dist);
  if (problems.length > 0) {
    console.error(problems.map((problem) => `- ${problem}`).join('\n'));
    process.exit(1);
  }
  console.log('dist/ je v pořádku.');
}
