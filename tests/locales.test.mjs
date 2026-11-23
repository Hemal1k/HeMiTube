/** Kontrola překladů: obě jazykové verze mají stejné klíče a každý klíč použitý v kódu existuje. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const load = (locale) => JSON.parse(readFileSync(join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
const cs = load('cs');
const en = load('en');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function usedKeys() {
  const keys = new Set();
  const sources = [...files(join(ROOT, 'src')), join(ROOT, 'manifest.json')];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/data-i18n(?:-title|-aria-label)?="(\w+)"/g)) keys.add(match[1]);
    for (const match of text.matchAll(/\bt\('(\w+)'/g)) keys.add(match[1]);
    for (const match of text.matchAll(/__MSG_(\w+)__/g)) keys.add(match[1]);
    // dynamické klíče t(`reveal_${value}`) apod.
    for (const match of text.matchAll(/\bt\(`(\w+)_\$\{value\}`\)/g)) {
      for (const key of Object.keys(cs)) if (key.startsWith(`${match[1]}_`)) keys.add(key);
    }
  }
  return keys;
}

test('cs a en mají stejné klíče', () => {
  assert.deepEqual(Object.keys(cs).sort(), Object.keys(en).sort());
});

test('každá zpráva má neprázdný text', () => {
  for (const [locale, messages] of [['cs', cs], ['en', en]]) {
    for (const [key, value] of Object.entries(messages)) {
      assert.ok(typeof value.message === 'string' && value.message.trim(), `${locale}: ${key}`);
    }
  }
});

test('všechny klíče použité v kódu existují', () => {
  for (const key of usedKeys()) assert.ok(key in cs, `chybí klíč v překladech: ${key}`);
});

test('dynamické klíče pro volby nastavení existují', async () => {
  const { REVEAL_OPTIONS, FPS_OPTIONS } = await import('../src/shared/settings.js');
  for (const value of REVEAL_OPTIONS) assert.ok(`reveal_${value}` in cs);
  for (const value of FPS_OPTIONS) assert.ok(`fps_${value}` in cs);
});
