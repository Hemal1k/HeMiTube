import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, defaultSettings, getPath, migrate, setPath } from '../src/shared/settings.js';

test('migrate: neplatný vstup → výchozí nastavení', () => {
  for (const raw of [null, undefined, 42, 'text', [], true]) assert.deepEqual(migrate(raw), defaultSettings());
});

test('migrate: zachová platné hodnoty a doplní chybějící', () => {
  const result = migrate({ theater: { autoTheater: true }, quality: { preferred: '1440', fps: 'cap30' } });
  assert.equal(result.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.theater.autoTheater, true);
  assert.equal(result.theater.fullWindow, true);
  assert.equal(result.quality.preferred, '1440');
  assert.equal(result.quality.fps, 'cap30');
  assert.equal(migrate({ quality: { fps: 'prefer60' } }).quality.fps, 'none', 'zrušená volba → Automaticky');
  assert.equal(result.dislikes.enabled, true);
});

test('migrate: chybné typy a hodnoty se nahradí výchozími', () => {
  const result = migrate({
    theater: { enabled: 'ano', revealMasthead: 'vždy' },
    quality: { preferred: '999', fallback: 'nahoru', fps: 120, embedPreferred: 'xx', theaterPreferred: '720' },
    codecs: { enabled: 1 },
  });
  const d = defaultSettings();
  assert.equal(result.theater.enabled, d.theater.enabled);
  assert.equal(result.theater.revealMasthead, d.theater.revealMasthead);
  assert.equal(result.quality.preferred, d.quality.preferred);
  assert.equal('fallback' in result.quality, false, 'zrušená volba fallback se zahodí');
  assert.equal(result.quality.fps, d.quality.fps);
  assert.equal(result.quality.embedPreferred, null);
  assert.equal('theaterPreferred' in result.quality, false, 'zrušená volba se zahodí');
  assert.equal(result.codecs.enabled, false);
});

test('migrate: kvalita jako číslo nebo „1080p“', () => {
  assert.equal(migrate({ quality: { preferred: 1080 } }).quality.preferred, '1080');
  assert.equal(migrate({ quality: { preferred: '720p' } }).quality.preferred, '720');
  assert.equal(migrate({ quality: { embedPreferred: '' } }).quality.embedPreferred, null);
  assert.equal(migrate({ quality: { embedPreferred: 480 } }).quality.embedPreferred, '480');
});

test('migrate: pořadí kodeků se doplní a vyčistí', () => {
  const result = migrate({ codecs: { order: ['h264', 'h264', 'xyz'], disabled: ['vp9', 'nic'], audioDisabled: ['opus', 'opus'] } });
  assert.deepEqual(result.codecs.order, ['h264', 'av1', 'vp9']);
  assert.deepEqual(result.codecs.disabled, ['vp9']);
  assert.deepEqual(result.codecs.audioDisabled, ['opus']);
});

test('migrate: nedovolí vypnout všechny kodeky', () => {
  const result = migrate({ codecs: { order: ['av1', 'vp9', 'h264'], disabled: ['av1', 'vp9', 'h264'], audioDisabled: ['opus', 'aac'] } });
  assert.deepEqual(result.codecs.disabled, ['av1', 'vp9']);
  assert.deepEqual(result.codecs.audioDisabled, ['opus']);
});

test('migrate: neznámé klíče se zahodí, výsledek je idempotentní', () => {
  const result = migrate({ hack: 1, theater: { foo: 'bar' } });
  assert.equal('hack' in result, false);
  assert.equal('foo' in result.theater, false);
  assert.deepEqual(migrate(result), result);
});

test('defaultSettings vrací nezávislou kopii', () => {
  const a = defaultSettings();
  a.codecs.order.reverse();
  assert.deepEqual(defaultSettings().codecs.order, ['av1', 'vp9', 'h264']);
});

test('getPath / setPath', () => {
  const settings = defaultSettings();
  assert.equal(getPath(settings, 'quality.preferred'), 'screen');
  setPath(settings, 'quality.preferred', '720');
  assert.equal(settings.quality.preferred, '720');
  assert.equal(getPath(settings, 'neni.tady'), undefined);
});

test('migrate: modul Skrýt Shorts', () => {
  assert.deepEqual(defaultSettings().hideShorts, { enabled: false, redirect: false });
  assert.deepEqual(migrate({ hideShorts: { enabled: true, redirect: 'ano' } }).hideShorts, { enabled: true, redirect: false });
  assert.deepEqual(migrate({ hideShorts: 'x' }).hideShorts, { enabled: false, redirect: false });
});

test('migrate: rychlost přehrávání a SponsorBlock', () => {
  const d = defaultSettings();
  assert.deepEqual(d.playback, { enabled: false, speed: '1.25', skipMusic: true });
  assert.deepEqual(d.sponsorBlock, { enabled: false, categories: ['sponsor'], notify: true });
  assert.equal(d.theater.noAmbient, false);
  assert.equal(migrate({ playback: { speed: 1.5 } }).playback.speed, '1.5');
  assert.equal(migrate({ playback: { speed: '3' } }).playback.speed, '1.25');
  assert.deepEqual(migrate({ sponsorBlock: { categories: ['intro', 'nic', 'intro', 'outro'] } }).sponsorBlock.categories, ['intro', 'outro']);
  assert.deepEqual(migrate({ sponsorBlock: { categories: [] } }).sponsorBlock.categories, []);
  assert.equal(migrate({ quality: { preferred: 'screen' } }).quality.preferred, 'screen');
});

test('migrate: rozptýlení a skrytí chatu', () => {
  const d = defaultSettings();
  assert.deepEqual(d.distractions, { endScreens: false, cards: false, related: false, homeFeed: false, comments: false });
  assert.equal(d.theater.hideLiveChat, false);
  const m = migrate({ distractions: { comments: true, related: 'ano', nic: true }, theater: { hideLiveChat: true } });
  assert.equal(m.distractions.comments, true);
  assert.equal(m.distractions.related, false);
  assert.equal('nic' in m.distractions, false);
  assert.equal(m.theater.hideLiveChat, true);
});
