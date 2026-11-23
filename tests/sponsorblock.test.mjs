import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSegments, sbQueryUrl, segmentToSkip } from '../src/shared/sponsorblock.js';

// Tvar odpovědi podle živého API (ověřeno 2026-11, /api/skipSegments/<prefix>)
const RESPONSE = [
  { videoID: 'jinéVideo01', segments: [{ category: 'sponsor', actionType: 'skip', segment: [1, 5], UUID: 'x' }] },
  {
    videoID: 'kJQP7kiw5Fk',
    segments: [
      { category: 'sponsor', actionType: 'skip', segment: [120, 150.5], UUID: 'b' },
      { category: 'music_offtopic', actionType: 'skip', segment: [0, 21.808434], UUID: 'a', votes: 41 },
      { category: 'poi_highlight', actionType: 'poi', segment: [60, 60], UUID: 'c' },
      { category: 'sponsor', actionType: 'mute', segment: [200, 210], UUID: 'd' },
      { category: 'intro', actionType: 'skip', segment: [30, 20], UUID: 'e' },
      { category: 'neznámá', actionType: 'skip', segment: [40, 45], UUID: 'f' },
    ],
  },
];

test('sbQueryUrl: prefix hashe, všechny kategorie, jen skip', () => {
  const url = new URL(sbQueryUrl('f1d9'));
  assert.equal(url.origin + url.pathname, 'https://sponsor.ajay.app/api/skipSegments/f1d9');
  assert.ok(JSON.parse(url.searchParams.get('categories')).includes('sponsor'));
  assert.deepEqual(JSON.parse(url.searchParams.get('actionTypes')), ['skip']);
});

test('parseSegments: jen dané video, typ skip, platné časy, seřazené', () => {
  const segments = parseSegments(RESPONSE, 'kJQP7kiw5Fk');
  assert.deepEqual(
    segments.map((s) => [s.category, s.start, s.end, s.uuid]),
    [
      ['music_offtopic', 0, 21.808434, 'a'],
      ['sponsor', 120, 150.5, 'b'],
    ],
  );
  assert.deepEqual(parseSegments(RESPONSE, 'neexistuje1'), []);
  assert.deepEqual(parseSegments(null, 'kJQP7kiw5Fk'), []);
  assert.deepEqual(parseSegments('chyba', 'kJQP7kiw5Fk'), []);
});

test('segmentToSkip: čas uvnitř, zapnutá kategorie, jen jednou', () => {
  const segments = parseSegments(RESPONSE, 'kJQP7kiw5Fk');
  assert.equal(segmentToSkip(segments, 125, ['sponsor'])?.uuid, 'b');
  assert.equal(segmentToSkip(segments, 5, ['sponsor']), null, 'kategorie music_offtopic není zapnutá');
  assert.equal(segmentToSkip(segments, 5, ['sponsor', 'music_offtopic'])?.uuid, 'a');
  assert.equal(segmentToSkip(segments, 119.9, ['sponsor']), null, 'před segmentem');
  assert.equal(segmentToSkip(segments, 150.3, ['sponsor']), null, 'těsně před koncem už ne');
  assert.equal(segmentToSkip(segments, 125, ['sponsor'], new Set(['b'])), null, 'už přeskočeno');
  assert.equal(segmentToSkip(segments, NaN, ['sponsor']), null);
  assert.equal(segmentToSkip(undefined, 10, ['sponsor']), null);
});

test('parseSegments: segment bez UUID dostane náhradní klíč (N-L9)', () => {
  const json = [{ videoID: 'abcdefghijk', segments: [
    { category: 'sponsor', actionType: 'skip', segment: [10, 20] },
    { category: 'sponsor', actionType: 'skip', segment: [40, 50] },
  ] }];
  const segments = parseSegments(json, 'abcdefghijk');
  assert.deepEqual(segments.map((s) => s.uuid), ['10-20', '40-50']);
  const skipped = new Set(['10-20']);
  assert.equal(segmentToSkip(segments, 45, ['sponsor'], skipped)?.uuid, '40-50', 'druhý segment se přeskočí i po prvním');
});
