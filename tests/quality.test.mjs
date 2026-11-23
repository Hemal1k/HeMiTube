import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectivePreferred,
  screenQuality,
  normalizeQualityData,
  normalizeQualityLevels,
  parseLabel,
  pickQuality,
} from '../src/shared/quality-logic.js';

// Tvar dat podle živého YouTube (ověřeno 2026-11 na /watch): quality | qualityLabel | isPlayable
const DATA_4K60 = [
  { quality: 'hd2160', qualityLabel: '2160p60 4K', isPlayable: true },
  { quality: 'hd1440', qualityLabel: '1440p60 HD', isPlayable: true },
  { quality: 'hd1080', qualityLabel: '1080p60 HD', isPlayable: true },
  { quality: 'hd1080', qualityLabel: '1080p60 Premium', isPlayable: true },
  { quality: 'hd720', qualityLabel: '720p60', isPlayable: true },
  { quality: 'large', qualityLabel: '480p', isPlayable: true },
  { quality: 'medium', qualityLabel: '360p', isPlayable: true },
  { quality: 'small', qualityLabel: '240p', isPlayable: true },
  { quality: 'tiny', qualityLabel: '144p', isPlayable: true },
  { quality: 'auto', qualityLabel: 'Auto', isPlayable: true },
];
const list4k = normalizeQualityData(DATA_4K60);
const list1080 = normalizeQualityData(DATA_4K60.slice(2));
const heights = (option) => option?.height;

test('parseLabel čte výšku a fps', () => {
  assert.deepEqual(parseLabel('1080p60 HD'), { height: 1080, fps: 60 });
  assert.deepEqual(parseLabel('720p'), { height: 720, fps: null });
  assert.deepEqual(parseLabel('2160s50'), { height: 2160, fps: 50 });
  assert.deepEqual(parseLabel(undefined), { height: null, fps: null });
});

test('normalizeQualityData: řazení, bez auto, bez duplicit, fps z labelu', () => {
  assert.deepEqual(list4k.map(heights), [2160, 1440, 1080, 720, 480, 360, 240, 144]);
  assert.equal(list4k[0].fps, 60);
  assert.equal(list4k.find((o) => o.height === 480).fps, 30);
  assert.equal(list4k.filter((o) => o.quality === 'hd1080').length, 1);
  assert.deepEqual(normalizeQualityData(null), []);
  assert.deepEqual(normalizeQualityData([{ quality: 'hd720', isPlayable: false }]), []);
});

test('normalizeQualityLevels (záložní API)', () => {
  const list = normalizeQualityLevels(['hd1080', 'hd720', 'large', 'auto', 'nesmysl']);
  assert.deepEqual(list.map(heights), [1080, 720, 480]);
  assert.equal(list[0].fps, 30);
});

test('pickQuality: max a přesná shoda', () => {
  assert.equal(pickQuality(list4k, 'max').quality, 'hd2160');
  assert.equal(pickQuality(list4k, '1080').quality, 'hd1080');
  assert.equal(pickQuality(list4k, 720).quality, 'hd720');
  assert.equal(pickQuality([], '1080'), null);
});

test('pickQuality: výchozí = nejbližší vyšší, jinak nejvyšší dostupná', () => {
  const sparse = normalizeQualityLevels(['hd2160', 'hd1080', 'medium']);
  assert.equal(pickQuality(sparse, '1440').height, 2160);
  assert.equal(pickQuality(sparse, '480').height, 1080);
  assert.equal(pickQuality(list1080, '4320').height, 1080);
  assert.equal(pickQuality(list1080, '2160').height, 1080);
});

test('pickQuality: fallback nejbližší nižší (volitelně)', () => {
  assert.equal(pickQuality(list1080, '4320', { fallback: 'lower' }).height, 1080);
  // nic nižšího → nejbližší vyšší
  const only720 = normalizeQualityLevels(['hd720', 'hd1080']);
  assert.equal(pickQuality(only720, '480').height, 720);
});

test('pickQuality: fallback nejbližší vyšší', () => {
  const sparse = normalizeQualityLevels(['hd2160', 'hd1080', 'medium']);
  assert.equal(pickQuality(sparse, '1440', { fallback: 'higher' }).height, 2160);
  assert.equal(pickQuality(sparse, '480', { fallback: 'higher' }).height, 1080);
  assert.equal(pickQuality(sparse, '480', { fallback: 'lower' }).height, 360);
  // nic vyššího → nejbližší nižší
  assert.equal(pickQuality(sparse, '4320', { fallback: 'higher' }).height, 2160);
});


test('effectivePreferred: zvláštní kvalita jen pro embed', () => {
  assert.equal(effectivePreferred({ preferred: '1080', embedPreferred: '720' }, 'default'), '1080');
  assert.equal(effectivePreferred({ preferred: '1080', embedPreferred: '720' }, 'embed'), '720');
  assert.equal(effectivePreferred({ preferred: '1080', embedPreferred: null }, 'embed'), '1080');
});

test('screenQuality: nejmenší standard, který pokryje obrazovku', () => {
  const cases = { 720: '720', 768: '720', 900: '1080', 1080: '1080', 1200: '1080', 1440: '1440', 1600: '1440', 2160: '2160', 4320: '4320', 9000: '4320' };
  for (const [height, expected] of Object.entries(cases)) assert.equal(screenQuality(Number(height)), expected, `obrazovka ${height}`);
  assert.equal(screenQuality(0), '1080');
  assert.equal(screenQuality(undefined), '1080');
});

test('pickQuality: „podle obrazovky“ nikdy nepřekročí obrazovku', () => {
  assert.equal(pickQuality(list4k, 'screen', { screenHeight: 1080 }).height, 1080);
  assert.equal(pickQuality(list4k, 'screen', { screenHeight: 1440 }).height, 1440);
  assert.equal(pickQuality(list4k, 'screen', { screenHeight: 2160 }).height, 2160);
  assert.equal(pickQuality(list4k, 'screen', { screenHeight: 900 }).height, 1080);
  // video bez 1440p na 1440p obrazovce → nejbližší nižší (1080p), ne 2160p
  const sparse = normalizeQualityLevels(['hd2160', 'hd1080', 'hd720']);
  assert.equal(pickQuality(sparse, 'screen', { screenHeight: 1440 }).height, 1080);
  // video jen do 720p → 720p
  assert.equal(pickQuality(normalizeQualityLevels(['hd720', 'large']), 'screen', { screenHeight: 2160 }).height, 720);
});
