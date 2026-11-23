/**
 * Modul kvality (N-S2): změna jiného modulu nesmí znovu nastavit kvalitu (přepsala by ruční volbu),
 * změna sekce „quality“ ano. DOM a most do MAIN worldu jsou podvržené.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/shared/settings.js';

globalThis.location = { href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', pathname: '/watch', hostname: 'www.youtube.com' };
globalThis.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: {}, fullscreenElement: null };
globalThis.HTMLVideoElement ??= class {};

const { initQuality } = await import('../src/content/quality.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('změna jiného modulu kvalitu znovu nenastaví, změna kvality ano', async () => {
  let settings = defaultSettings();
  const calls = [];
  const bridge = { call: async (type, data) => (calls.push({ type, data }), { ok: false, reason: 'no-player' }) };
  const module = initQuality({ bridge, getSettings: () => settings, isTop: true });

  module.onNavigate({ pageType: 'watch', videoId: 'dQw4w9WgXcQ' });
  await wait(450);
  assert.equal(calls.length, 1, 'po navigaci se kvalita nastaví');

  // Jiný modul (Skrýt Shorts, dislike) → bez nového nastavení kvality.
  settings = structuredClone(settings);
  settings.hideShorts.enabled = true;
  settings.dislikes.ratioBar = true;
  module.onSettings(settings);
  await wait(450);
  assert.equal(calls.length, 1, 'změna jiného modulu nesmí přepsat kvalitu');

  // Změna preferované kvality → nastaví se hned.
  settings = structuredClone(settings);
  settings.quality.preferred = '720';
  module.onSettings(settings);
  await wait(450);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].data.preferred, '720');
});

test('kvalita se u jednoho videa nastaví jen jednou (opakované canplay nezpůsobí smyčku)', async () => {
  const listeners = {};
  globalThis.document.addEventListener = (type, fn) => { (listeners[type] ??= []).push(fn); };
  let settings = defaultSettings();
  const calls = [];
  const bridge = { call: async (type) => (calls.push(type), type === 'applyQuality' ? { ok: true, target: 'hd1080', targetHeight: 1080 } : { quality: 'hd1080', adShowing: false }) };
  const module = initQuality({ bridge, getSettings: () => settings, isTop: true });
  module.onNavigate({ pageType: 'watch', videoId: 'dQw4w9WgXcQ' });
  await wait(450);
  const video = new globalThis.HTMLVideoElement();
  for (let i = 0; i < 5; i++) {
    for (const fn of listeners.canplay ?? []) fn({ target: video });
    await wait(400);
  }
  assert.equal(calls.filter((c) => c === 'applyQuality').length, 1, 'kvalita se nastavila víckrát než jednou');
  // Jiné video → znovu
  module.onNavigate({ pageType: 'watch', videoId: 'aaaaaaaaaaa' });
  await wait(450);
  assert.equal(calls.filter((c) => c === 'applyQuality').length, 2);
});
