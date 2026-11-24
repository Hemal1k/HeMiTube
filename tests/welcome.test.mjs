/** Uvítání po první instalaci: jen při reason 'install', aktualizace nic neotevírá. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WELCOME_PATH, isFirstInstall, isWelcomeSearch } from '../src/shared/welcome.js';

const ROOT = join(import.meta.dirname, '..');

test('uvítání jen při první instalaci', () => {
  assert.equal(isFirstInstall({ reason: 'install' }), true);
  assert.equal(isFirstInstall({ reason: 'update', previousVersion: '1.0.0' }), false);
  assert.equal(isFirstInstall({ reason: 'chrome_update' }), false);
  assert.equal(isFirstInstall({ reason: 'shared_module_update' }), false);
  assert.equal(isFirstInstall(undefined), false);
  assert.equal(isFirstInstall({}), false);
});

test('stránka nastavení pozná, že ji otevřelo uvítání', () => {
  assert.equal(isWelcomeSearch('?welcome=1'), true);
  assert.equal(isWelcomeSearch(new URL(WELCOME_PATH, 'chrome-extension://x/').search), true);
  assert.equal(isWelcomeSearch(''), false);
  assert.equal(isWelcomeSearch('?welcome=0'), false);
  assert.equal(isWelcomeSearch(undefined), false);
});

test('uvítání míří na stránku nastavení z manifestu a na kartu dislajků', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const url = new URL(WELCOME_PATH, 'chrome-extension://x/');
  assert.equal(url.pathname.slice(1), manifest.options_ui.page);
  const html = readFileSync(join(ROOT, 'src', 'options', 'options.html'), 'utf8');
  assert.ok(html.includes(`id="${url.hash.slice(1)}"`));
  assert.ok(html.includes('id="welcome"'));
});
